// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {PoolTestBase} from "./PoolTestBase.sol";
import {PredictionPool} from "../src/PredictionPool.sol";

/// FR-C-04: winners get stake * (total - fee) / winningTotal; fee goes to the treasury once.
/// FR-C-05: losers cannot claim; no double claim.
contract ClaimTest is PoolTestBase {
    uint256 internal id;

    function setUp() public override {
        super.setUp();
        id = _create(ONE_HOUR);
    }

    /// REQUIREMENTS FR-C-04 example: YES $60, NO $40, 2% fee, YES wins, a $30 YES stake claims $49.
    function test_claim_payoutExample() public {
        _stake(alice, id, true, 30e6);
        _stake(bob, id, true, 30e6);
        _stake(carol, id, false, 40e6);
        _resolve(id, true);

        vm.expectEmit(true, true, false, true, address(pool));
        emit PredictionPool.Claimed(id, alice, 49e6);
        vm.prank(alice);
        pool.claim(id);

        assertEq(usdc.balanceOf(alice), 49e6);
        assertEq(usdc.balanceOf(treasury), 2e6);
        assertTrue(pool.feePaid(id));
        (,, bool claimed) = pool.getPosition(id, alice);
        assertTrue(claimed);

        vm.prank(bob);
        pool.claim(id);
        assertEq(usdc.balanceOf(bob), 49e6);
        assertEq(usdc.balanceOf(treasury), 2e6, "fee paid exactly once");
        assertEq(usdc.balanceOf(address(pool)), 0);
    }

    function test_claim_noSideWins() public {
        _stake(alice, id, true, 60e6);
        _stake(carol, id, false, 40e6);
        _resolve(id, false);
        vm.prank(carol);
        pool.claim(id);
        assertEq(usdc.balanceOf(carol), 98e6);
        assertEq(usdc.balanceOf(treasury), 2e6);
    }

    function test_claim_hedgedUserPaidOnWinningSideOnly() public {
        _stake(alice, id, true, 30e6);
        _stake(alice, id, false, 10e6);
        _stake(bob, id, false, 60e6);
        _resolve(id, true);
        vm.prank(alice);
        pool.claim(id);
        assertEq(usdc.balanceOf(alice), 98e6);
    }

    function test_claim_loserReverts() public {
        _stake(alice, id, true, 60e6);
        _stake(carol, id, false, 40e6);
        _resolve(id, true);
        vm.expectRevert(abi.encodeWithSelector(PredictionPool.NothingToClaim.selector, id, carol));
        vm.prank(carol);
        pool.claim(id);
    }

    function test_claim_strangerReverts() public {
        _stake(alice, id, true, 60e6);
        _stake(carol, id, false, 40e6);
        _resolve(id, true);
        vm.expectRevert(abi.encodeWithSelector(PredictionPool.NothingToClaim.selector, id, stranger));
        vm.prank(stranger);
        pool.claim(id);
    }

    function test_claim_doubleReverts() public {
        _stake(alice, id, true, 60e6);
        _stake(carol, id, false, 40e6);
        _resolve(id, true);
        vm.prank(alice);
        pool.claim(id);
        vm.expectRevert(abi.encodeWithSelector(PredictionPool.AlreadyClaimed.selector, id, alice));
        vm.prank(alice);
        pool.claim(id);
        assertEq(usdc.balanceOf(alice), 98e6);
    }

    function test_claim_beforeResolutionReverts() public {
        _stake(alice, id, true, 60e6);
        _stake(carol, id, false, 40e6);
        _warpPast(id);
        vm.expectRevert(abi.encodeWithSelector(PredictionPool.NotResolved.selector, id));
        vm.prank(alice);
        pool.claim(id);
    }

    function test_claim_voidPoolReverts() public {
        _stake(alice, id, true, 60e6);
        _resolve(id, true);
        vm.expectRevert(abi.encodeWithSelector(PredictionPool.PoolIsVoid.selector, id));
        vm.prank(alice);
        pool.claim(id);
    }

    /// Payouts plus the fee never exceed what was staked, whatever the split and the outcome.
    function testFuzz_claim_neverPaysMoreThanTotal(uint64 a, uint64 b, uint64 c, uint64 d, bool outcomeYes) public {
        uint256[4] memory amounts = [_amount(a), _amount(b), _amount(c), _amount(d)];
        address[4] memory users = [alice, bob, carol, stranger];
        // alice and bob on YES, carol and stranger on NO, so neither side is empty.
        for (uint256 i = 0; i < 4; i++) {
            _stake(users[i], id, i < 2, amounts[i]);
        }
        uint256 total = amounts[0] + amounts[1] + amounts[2] + amounts[3];
        _resolve(id, outcomeYes);

        uint256 paid;
        uint256 start = outcomeYes ? 0 : 2;
        for (uint256 i = start; i < start + 2; i++) {
            vm.prank(users[i]);
            pool.claim(id);
            paid += usdc.balanceOf(users[i]);
        }
        uint256 fee = usdc.balanceOf(treasury);
        assertEq(fee, total * pool.FEE_BPS_DEFAULT() / pool.BPS_DENOMINATOR());
        assertLe(paid + fee, total);
        // Floor division leaves at most one base unit of dust per winner.
        assertLe(total - paid - fee, 2);
        assertEq(usdc.balanceOf(address(pool)), total - paid - fee);
    }

    function _amount(uint64 x) private pure returns (uint256) {
        return bound(uint256(x), 1, 10_000e6);
    }
}
