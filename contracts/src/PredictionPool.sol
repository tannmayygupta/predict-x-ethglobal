// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IReceiver} from "./interfaces/IReceiver.sol";

/// @title PredictionPool
/// @notice Parimutuel YES/NO pools on a token price, resolved by a Chainlink CRE report.
/// There is deliberately no owner and no admin function (FR-C-07): outcomes come only from the
/// forwarder, and funds leave only through claim, refund and the one-time fee.
contract PredictionPool is IReceiver, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// Field order is part of the ABI the backend decodes (packages/shared/src/abi.ts).
    struct Pool {
        string question;
        string coingeckoId;
        uint8 direction;
        uint256 strikeE18;
        uint64 resolveTime;
        uint64 createdAt;
        uint256 yesTotal;
        uint256 noTotal;
        bool resolved;
        bool outcomeYes;
        uint256 resolvedPriceE18;
        uint16 feeBps;
        address creator;
    }

    struct Position {
        uint256 yesStake;
        uint256 noStake;
        bool claimed;
    }

    // Mirrors packages/shared/src/constants.ts.
    uint16 public constant FEE_BPS_DEFAULT = 200;
    uint16 public constant BPS_DENOMINATOR = 10_000;
    uint64 public constant MIN_POOL_DURATION_SECONDS = 120;
    uint256 public constant MAX_QUESTION_LENGTH = 140;
    uint8 public constant DIRECTION_BELOW = 1;

    IERC20 public immutable usdc;
    address public immutable forwarder;
    address public immutable treasury;

    Pool[] private _pools;
    mapping(uint256 id => mapping(address user => Position)) private _positions;
    mapping(uint256 id => bool) public feePaid;

    error ZeroAddress();
    error PoolNotFound(uint256 id);
    error ResolveTimeTooSoon(uint64 resolveTime);
    error QuestionTooLong(uint256 length);
    error InvalidDirection(uint8 direction);
    error ZeroAmount();
    error StakingClosed(uint256 id);
    /// Same name and arguments as Chainlink ReceiverTemplate.
    error InvalidSender(address sender, address expected);
    error AlreadyResolved(uint256 id);
    error TooEarly(uint256 id);
    error NotResolved(uint256 id);
    error PoolIsVoid(uint256 id);
    error PoolNotVoid(uint256 id);
    error NothingToClaim(uint256 id, address user);
    error AlreadyClaimed(uint256 id, address user);

    event PoolCreated(
        uint256 indexed id,
        address indexed creator,
        string question,
        string coingeckoId,
        uint8 direction,
        uint256 strikeE18,
        uint64 resolveTime
    );
    event Staked(uint256 indexed id, address indexed user, bool isYes, uint256 amount);
    event Resolved(uint256 indexed id, bool outcomeYes, uint256 priceE18);
    event Claimed(uint256 indexed id, address indexed user, uint256 amount);
    event Refunded(uint256 indexed id, address indexed user, uint256 amount);

    constructor(address usdc_, address forwarder_, address treasury_) {
        if (usdc_ == address(0) || forwarder_ == address(0) || treasury_ == address(0)) revert ZeroAddress();
        usdc = IERC20(usdc_);
        forwarder = forwarder_;
        treasury = treasury_;
    }

    /* ---------- writes ---------- */

    function createPool(
        string calldata question,
        string calldata coingeckoId,
        uint8 direction,
        uint256 strikeE18,
        uint64 resolveTime
    ) external returns (uint256 id) {
        if (resolveTime < block.timestamp + MIN_POOL_DURATION_SECONDS) {
            revert ResolveTimeTooSoon(resolveTime);
        }
        if (bytes(question).length > MAX_QUESTION_LENGTH) revert QuestionTooLong(bytes(question).length);
        if (direction > DIRECTION_BELOW) revert InvalidDirection(direction);

        id = _pools.length;
        Pool storage p = _pools.push();
        p.question = question;
        p.coingeckoId = coingeckoId;
        p.direction = direction;
        p.strikeE18 = strikeE18;
        p.resolveTime = resolveTime;
        // uint64 seconds cannot overflow for billions of years; matches the ABI width.
        // forge-lint: disable-next-line(unsafe-typecast)
        p.createdAt = uint64(block.timestamp);
        p.feeBps = FEE_BPS_DEFAULT;
        p.creator = msg.sender;

        emit PoolCreated(id, msg.sender, question, coingeckoId, direction, strikeE18, resolveTime);
    }

    /// @notice Lock time equals resolve time (D-006). Approve exactly `amount` first.
    function stake(uint256 poolId, bool isYes, uint256 amount) external nonReentrant {
        Pool storage p = _pool(poolId);
        if (amount == 0) revert ZeroAmount();
        if (block.timestamp >= p.resolveTime) revert StakingClosed(poolId);

        Position storage pos = _positions[poolId][msg.sender];
        if (isYes) {
            p.yesTotal += amount;
            pos.yesStake += amount;
        } else {
            p.noTotal += amount;
            pos.noStake += amount;
        }
        emit Staked(poolId, msg.sender, isYes, amount);

        usdc.safeTransferFrom(msg.sender, address(this), amount);
    }

    /// @notice Winner payout = stake * (total - fee) / winningTotal. The first claim also sends the
    /// pool fee to the treasury, so the fee moves once and only for pools that have a winner.
    function claim(uint256 poolId) external nonReentrant {
        Pool storage p = _pool(poolId);
        if (!p.resolved) revert NotResolved(poolId);
        if (_isVoid(p)) revert PoolIsVoid(poolId);

        Position storage pos = _positions[poolId][msg.sender];
        if (pos.claimed) revert AlreadyClaimed(poolId, msg.sender);
        uint256 winningStake = p.outcomeYes ? pos.yesStake : pos.noStake;
        if (winningStake == 0) revert NothingToClaim(poolId, msg.sender);

        uint256 total = p.yesTotal + p.noTotal;
        uint256 fee = total * p.feeBps / BPS_DENOMINATOR;
        uint256 winningTotal = p.outcomeYes ? p.yesTotal : p.noTotal;
        uint256 payout = winningStake * (total - fee) / winningTotal;

        pos.claimed = true;
        bool payFee = !feePaid[poolId];
        if (payFee) feePaid[poolId] = true;
        emit Claimed(poolId, msg.sender, payout);

        if (payFee && fee > 0) usdc.safeTransfer(treasury, fee);
        usdc.safeTransfer(msg.sender, payout);
    }

    /// @notice Void pools only: returns the caller's whole stake (YES plus NO), no fee.
    function refund(uint256 poolId) external nonReentrant {
        Pool storage p = _pool(poolId);
        if (!p.resolved) revert NotResolved(poolId);
        if (!_isVoid(p)) revert PoolNotVoid(poolId);

        Position storage pos = _positions[poolId][msg.sender];
        if (pos.claimed) revert AlreadyClaimed(poolId, msg.sender);
        uint256 amount = pos.yesStake + pos.noStake;
        if (amount == 0) revert NothingToClaim(poolId, msg.sender);

        pos.claimed = true;
        emit Refunded(poolId, msg.sender, amount);

        usdc.safeTransfer(msg.sender, amount);
    }

    /// @notice CRE IReceiver entry point. report = abi.encode(uint256 poolId, bool outcomeYes, uint256 priceE18).
    /// Metadata (workflow identity) is not checked: the immutable forwarder is the only trusted caller,
    /// and its length differs between simulation and production delivery.
    function onReport(bytes calldata metadata, bytes calldata report) external {
        metadata; // part of the IReceiver signature; intentionally unused
        if (msg.sender != forwarder) revert InvalidSender(msg.sender, forwarder);
        (uint256 poolId, bool outcomeYes, uint256 priceE18) = abi.decode(report, (uint256, bool, uint256));

        Pool storage p = _pool(poolId);
        if (p.resolved) revert AlreadyResolved(poolId);
        if (block.timestamp < p.resolveTime) revert TooEarly(poolId);

        p.resolved = true;
        p.outcomeYes = outcomeYes;
        p.resolvedPriceE18 = priceE18;
        emit Resolved(poolId, outcomeYes, priceE18);
    }

    /* ---------- views (FR-C-08) ---------- */

    function poolCount() external view returns (uint256 count) {
        return _pools.length;
    }

    function getPool(uint256 id) external view returns (Pool memory pool) {
        return _pool(id);
    }

    function getPosition(uint256 id, address user)
        external
        view
        returns (uint256 yesStake, uint256 noStake, bool claimed)
    {
        Position storage pos = _positions[id][user];
        return (pos.yesStake, pos.noStake, pos.claimed);
    }

    /// @notice Unresolved pools whose resolveTime has passed, oldest first, at most `max` ids.
    /// Read by the CRE workflow every run; a linear scan is fine at hackathon pool counts.
    function getDuePoolIds(uint256 max) external view returns (uint256[] memory ids) {
        uint256 count = _pools.length;
        ids = new uint256[](max < count ? max : count);
        uint256 found = 0;
        for (uint256 id = 0; id < count && found < ids.length; id++) {
            Pool storage p = _pools[id];
            if (!p.resolved && block.timestamp >= p.resolveTime) ids[found++] = id;
        }
        // Shrink the array to the ids actually found; only lowers the length word.
        assembly ("memory-safe") {
            mstore(ids, found)
        }
    }

    /// @notice The KeystoneForwarder checks IReceiver support through ERC-165 before delivering.
    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == type(IReceiver).interfaceId || interfaceId == type(IERC165).interfaceId;
    }

    /* ---------- internal ---------- */

    /// One side empty at resolution: nobody won, so everyone is refunded and no fee is taken.
    function _isVoid(Pool storage p) private view returns (bool) {
        return p.yesTotal == 0 || p.noTotal == 0;
    }

    function _pool(uint256 id) private view returns (Pool storage) {
        if (id >= _pools.length) revert PoolNotFound(id);
        return _pools[id];
    }
}
