// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {PoolTestBase} from "./PoolTestBase.sol";
import {PredictionPool} from "../src/PredictionPool.sol";

/// FR-C-01: createPool stores the fields; resolveTime >= now + 120 s; question at most 140 bytes.
contract CreatePoolTest is PoolTestBase {
    function test_create_storesFieldsAndEmits() public {
        uint64 resolveTime = uint64(block.timestamp) + ONE_HOUR;
        vm.expectEmit(true, true, false, true, address(pool));
        emit PredictionPool.PoolCreated(0, creator, QUESTION, COINGECKO_ID, 1, STRIKE_E18, resolveTime);
        vm.prank(creator);
        uint256 id = pool.createPool(QUESTION, COINGECKO_ID, 1, STRIKE_E18, resolveTime);

        assertEq(id, 0);
        assertEq(pool.poolCount(), 1);
        PredictionPool.Pool memory p = pool.getPool(id);
        assertEq(p.question, QUESTION);
        assertEq(p.coingeckoId, COINGECKO_ID);
        assertEq(p.direction, 1);
        assertEq(p.strikeE18, STRIKE_E18);
        assertEq(p.resolveTime, resolveTime);
        assertEq(p.createdAt, uint64(block.timestamp));
        assertEq(p.yesTotal, 0);
        assertEq(p.noTotal, 0);
        assertFalse(p.resolved);
        assertFalse(p.outcomeYes);
        assertEq(p.resolvedPriceE18, 0);
        assertEq(p.feeBps, pool.FEE_BPS_DEFAULT());
        assertEq(p.feeBps, 200);
        assertEq(p.creator, creator);
    }

    function test_create_idsIncrement() public {
        assertEq(_create(ONE_HOUR), 0);
        assertEq(_create(ONE_HOUR), 1);
        assertEq(pool.poolCount(), 2);
    }

    function test_create_exactMinimumDurationOk() public {
        uint256 id = _create(MIN_DURATION);
        assertEq(pool.getPool(id).resolveTime, block.timestamp + MIN_DURATION);
    }

    function test_create_tooSoonReverts() public {
        uint64 resolveTime = uint64(block.timestamp) + MIN_DURATION - 1;
        vm.expectRevert(abi.encodeWithSelector(PredictionPool.ResolveTimeTooSoon.selector, resolveTime));
        pool.createPool(QUESTION, COINGECKO_ID, ABOVE, STRIKE_E18, resolveTime);
    }

    function test_create_questionAt140Ok() public {
        pool.createPool(_repeat(140), COINGECKO_ID, ABOVE, STRIKE_E18, uint64(block.timestamp) + ONE_HOUR);
        assertEq(pool.poolCount(), 1);
    }

    function test_create_questionTooLongReverts() public {
        vm.expectRevert(abi.encodeWithSelector(PredictionPool.QuestionTooLong.selector, 141));
        pool.createPool(_repeat(141), COINGECKO_ID, ABOVE, STRIKE_E18, uint64(block.timestamp) + ONE_HOUR);
    }

    function test_create_badDirectionReverts() public {
        vm.expectRevert(abi.encodeWithSelector(PredictionPool.InvalidDirection.selector, 2));
        pool.createPool(QUESTION, COINGECKO_ID, 2, STRIKE_E18, uint64(block.timestamp) + ONE_HOUR);
    }

    function test_getPool_unknownIdReverts() public {
        vm.expectRevert(abi.encodeWithSelector(PredictionPool.PoolNotFound.selector, 0));
        pool.getPool(0);
    }

    function test_constructor_zeroAddressReverts() public {
        vm.expectRevert(PredictionPool.ZeroAddress.selector);
        new PredictionPool(address(usdc), address(0), treasury);
    }

    function _repeat(uint256 n) private pure returns (string memory) {
        bytes memory b = new bytes(n);
        for (uint256 i = 0; i < n; i++) {
            b[i] = "a";
        }
        return string(b);
    }
}
