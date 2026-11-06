// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {PoolTestBase} from "./PoolTestBase.sol";
import {PredictionPool} from "../src/PredictionPool.sol";

/// FR-C-06: a void pool (one side empty at resolution) refunds the full stake with no fee.
contract RefundTest is PoolTestBase {
    uint256 internal id;

    function setUp() public override {
        super.setUp();
        id = _create(ONE_HOUR);
    }

    function test_refund_voidYesOnlyExactNoFee() public {
        _stake(alice, id, true, 30e6);
        _stake(bob, id, true, 20e6);
        _resolve(id, true);

        vm.expectEmit(true, true, false, true, address(pool));
        emit PredictionPool.Refunded(id, alice, 30e6);
        vm.prank(alice);
        pool.refund(id);
        vm.prank(bob);
        pool.refund(id);

        assertEq(usdc.balanceOf(alice), 30e6);
        assertEq(usdc.balanceOf(bob), 20e6);
        assertEq(usdc.balanceOf(treasury), 0, "no fee moved");
        assertFalse(pool.feePaid(id));
        assertEq(usdc.balanceOf(address(pool)), 0);
        (,, bool claimed) = pool.getPosition(id, alice);
        assertTrue(claimed);
    }

    function test_refund_voidNoOnlyEvenIfOutcomeNo() public {
        _stake(carol, id, false, 40e6);
        _resolve(id, false);
        vm.prank(carol);
        pool.refund(id);
        assertEq(usdc.balanceOf(carol), 40e6);
        assertEq(usdc.balanceOf(treasury), 0);
    }

    function test_refund_hedgedSoleUserPoolIsNotVoid() public {
        // One user on both sides still fills both totals, so the pool is not void.
        _stake(alice, id, true, 10e6);
        _stake(alice, id, false, 5e6);
        _resolve(id, true);
        vm.expectRevert(abi.encodeWithSelector(PredictionPool.PoolNotVoid.selector, id));
        vm.prank(alice);
        pool.refund(id);
    }

    function test_refund_twiceReverts() public {
        _stake(alice, id, true, 30e6);
        _resolve(id, true);
        vm.prank(alice);
        pool.refund(id);
        vm.expectRevert(abi.encodeWithSelector(PredictionPool.AlreadyClaimed.selector, id, alice));
        vm.prank(alice);
        pool.refund(id);
        assertEq(usdc.balanceOf(alice), 30e6);
    }

    function test_refund_nonVoidReverts() public {
        _stake(alice, id, true, 60e6);
        _stake(carol, id, false, 40e6);
        _resolve(id, true);
        vm.expectRevert(abi.encodeWithSelector(PredictionPool.PoolNotVoid.selector, id));
        vm.prank(carol);
        pool.refund(id);
    }

    function test_refund_unresolvedReverts() public {
        _stake(alice, id, true, 30e6);
        _warpPast(id);
        vm.expectRevert(abi.encodeWithSelector(PredictionPool.NotResolved.selector, id));
        vm.prank(alice);
        pool.refund(id);
    }

    function test_refund_nothingStakedReverts() public {
        _stake(alice, id, true, 30e6);
        _resolve(id, true);
        vm.expectRevert(abi.encodeWithSelector(PredictionPool.NothingToClaim.selector, id, stranger));
        vm.prank(stranger);
        pool.refund(id);
    }
}
