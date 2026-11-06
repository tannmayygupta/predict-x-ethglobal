// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Test USDC for Base Sepolia pools. Anyone can mint, capped per call so the faucet stays sane.
/// The ERC-20 overrides only rename parameters and returns to match packages/shared/src/abi.ts.
contract MockUSDC is ERC20 {
    uint8 private constant USDC_DECIMALS = 6;
    // Immutable rather than a constant return so decimals() stays `view`, as in the shared ABI.
    uint8 private immutable _decimals = USDC_DECIMALS;
    uint256 public constant MAX_MINT_PER_CALL = 1_000e6;

    error MintCapExceeded(uint256 amount, uint256 max);

    constructor() ERC20("Mock USDC", "USDC") {}

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    function mint(address to, uint256 amount) external {
        if (amount > MAX_MINT_PER_CALL) revert MintCapExceeded(amount, MAX_MINT_PER_CALL);
        _mint(to, amount);
    }

    function approve(address spender, uint256 amount) public override returns (bool ok) {
        return super.approve(spender, amount);
    }

    function allowance(address owner, address spender) public view override returns (uint256 remaining) {
        return super.allowance(owner, spender);
    }

    function balanceOf(address account) public view override returns (uint256 balance) {
        return super.balanceOf(account);
    }
}
