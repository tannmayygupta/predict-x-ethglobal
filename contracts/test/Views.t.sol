// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {PoolTestBase} from "./PoolTestBase.sol";

/// FR-C-08: poolCount, getPool, getPosition, getDuePoolIds(max) (only unresolved pools past resolveTime).
contract ViewsTest is PoolTestBase {
    function test_views_emptyContract() public view {
        assertEq(pool.poolCount(), 0);
        assertEq(pool.getDuePoolIds(10).length, 0);
        (uint256 yesStake, uint256 noStake, bool claimed) = pool.getPosition(0, alice);
        assertEq(yesStake + noStake, 0);
        assertFalse(claimed);
    }

    function test_due_onlyUnresolvedPastResolveTime() public {
        uint256 a = _create(ONE_HOUR); // 0
        _create(2 * ONE_HOUR); // 1, not yet due
        uint256 c = _create(MIN_DURATION); // 2

        assertEq(pool.getDuePoolIds(10).length, 0, "nothing due before any resolveTime");

        vm.warp(block.timestamp + MIN_DURATION);
        uint256[] memory due = pool.getDuePoolIds(10);
        assertEq(due.length, 1);
        assertEq(due[0], c, "due exactly at resolveTime");

        vm.warp(block.timestamp + ONE_HOUR);
        due = pool.getDuePoolIds(10);
        assertEq(due.length, 2);
        assertEq(due[0], a);
        assertEq(due[1], c);

        _report(a, true);
        due = pool.getDuePoolIds(10);
        assertEq(due.length, 1, "resolved pools are excluded");
        assertEq(due[0], c);
    }

    function test_due_respectsMax() public {
        for (uint256 i = 0; i < 5; i++) {
            _create(MIN_DURATION);
        }
        vm.warp(block.timestamp + MIN_DURATION);
        assertEq(pool.getDuePoolIds(10).length, 5);
        uint256[] memory due = pool.getDuePoolIds(3);
        assertEq(due.length, 3);
        assertEq(due[0], 0);
        assertEq(due[2], 2);
        assertEq(pool.getDuePoolIds(0).length, 0);
    }
}
