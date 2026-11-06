// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {PoolTestBase} from "./PoolTestBase.sol";
import {PredictionPool} from "../src/PredictionPool.sol";

/// FR-C-02: stake pulls USDC and records per-user stakes; reverts at or after resolveTime and for 0.
contract StakeTest is PoolTestBase {
    uint256 internal id;

    function setUp() public override {
        super.setUp();
        id = _create(ONE_HOUR);
    }

    function test_stake_pullsUsdcAndRecords() public {
        _fund(alice, 10e6);
        vm.prank(alice);
        usdc.approve(address(pool), 10e6);

        vm.expectEmit(true, true, false, true, address(pool));
        emit PredictionPool.Staked(id, alice, true, 7e6);
        vm.prank(alice);
        pool.stake(id, true, 7e6);
        vm.prank(alice);
        pool.stake(id, false, 3e6);

        assertEq(usdc.balanceOf(alice), 0);
        assertEq(usdc.balanceOf(address(pool)), 10e6);
        (uint256 yesStake, uint256 noStake, bool claimed) = pool.getPosition(id, alice);
        assertEq(yesStake, 7e6);
        assertEq(noStake, 3e6);
        assertFalse(claimed);
        PredictionPool.Pool memory p = pool.getPool(id);
        assertEq(p.yesTotal, 7e6);
        assertEq(p.noTotal, 3e6);
    }

    function test_stake_accumulatesAcrossUsers() public {
        _stake(alice, id, true, 5e6);
        _stake(bob, id, true, 2e6);
        _stake(alice, id, true, 1e6);
        assertEq(pool.getPool(id).yesTotal, 8e6);
        (uint256 yesStake,,) = pool.getPosition(id, alice);
        assertEq(yesStake, 6e6);
    }

    function test_stake_zeroReverts() public {
        vm.expectRevert(PredictionPool.ZeroAmount.selector);
        vm.prank(alice);
        pool.stake(id, true, 0);
    }

    function test_stake_atResolveTimeReverts() public {
        _fund(alice, 1e6);
        vm.prank(alice);
        usdc.approve(address(pool), 1e6);
        _warpPast(id);
        vm.expectRevert(abi.encodeWithSelector(PredictionPool.StakingClosed.selector, id));
        vm.prank(alice);
        pool.stake(id, true, 1e6);
    }

    function test_stake_afterResolveTimeReverts() public {
        vm.warp(block.timestamp + ONE_HOUR + 1);
        vm.expectRevert(abi.encodeWithSelector(PredictionPool.StakingClosed.selector, id));
        vm.prank(alice);
        pool.stake(id, false, 1e6);
    }

    function test_stake_withoutApprovalReverts() public {
        _fund(alice, 1e6);
        vm.expectRevert();
        vm.prank(alice);
        pool.stake(id, true, 1e6);
    }

    function test_stake_unknownPoolReverts() public {
        vm.expectRevert(abi.encodeWithSelector(PredictionPool.PoolNotFound.selector, 99));
        pool.stake(99, true, 1e6);
    }
}
