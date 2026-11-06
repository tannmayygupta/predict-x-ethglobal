// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {PoolTestBase} from "./PoolTestBase.sol";
import {PredictionPool} from "../src/PredictionPool.sol";
import {IReceiver} from "../src/interfaces/IReceiver.sol";

/// FR-C-03: onReport only from the forwarder; decodes (poolId, outcomeYes, priceE18);
/// reverts when already resolved or before resolveTime.
contract OnReportTest is PoolTestBase {
    uint256 internal id;
    // Production KeystoneForwarder delivers 64 bytes of metadata; the contract must not care.
    bytes internal constant METADATA = hex"0000000000000000000000000000000000000000000000000000000000000001"
        hex"0000000000000000000000000000000000000000000000000000000000000002";

    function setUp() public override {
        super.setUp();
        id = _create(ONE_HOUR);
    }

    function test_report_fromForwarderResolves() public {
        _warpPast(id);
        vm.expectEmit(true, false, false, true, address(pool));
        emit PredictionPool.Resolved(id, true, PRICE_E18);
        vm.prank(forwarder);
        pool.onReport(METADATA, abi.encode(id, true, PRICE_E18));

        PredictionPool.Pool memory p = pool.getPool(id);
        assertTrue(p.resolved);
        assertTrue(p.outcomeYes);
        assertEq(p.resolvedPriceE18, PRICE_E18);
    }

    function test_report_storesNoOutcome() public {
        _resolve(id, false);
        PredictionPool.Pool memory p = pool.getPool(id);
        assertTrue(p.resolved);
        assertFalse(p.outcomeYes);
    }

    function test_report_strangerReverts() public {
        _warpPast(id);
        vm.expectRevert(abi.encodeWithSelector(PredictionPool.InvalidSender.selector, stranger, forwarder));
        vm.prank(stranger);
        pool.onReport(METADATA, abi.encode(id, true, PRICE_E18));
    }

    function test_report_creatorAndTreasuryCannotResolve() public {
        _warpPast(id);
        vm.expectRevert(abi.encodeWithSelector(PredictionPool.InvalidSender.selector, creator, forwarder));
        vm.prank(creator);
        pool.onReport("", abi.encode(id, true, PRICE_E18));
        vm.expectRevert(abi.encodeWithSelector(PredictionPool.InvalidSender.selector, treasury, forwarder));
        vm.prank(treasury);
        pool.onReport("", abi.encode(id, true, PRICE_E18));
    }

    function test_report_doubleReverts() public {
        _resolve(id, true);
        vm.expectRevert(abi.encodeWithSelector(PredictionPool.AlreadyResolved.selector, id));
        _report(id, false);
        assertTrue(pool.getPool(id).outcomeYes);
    }

    function test_report_earlyReverts() public {
        vm.warp(pool.getPool(id).resolveTime - 1);
        vm.expectRevert(abi.encodeWithSelector(PredictionPool.TooEarly.selector, id));
        _report(id, true);
    }

    function test_report_unknownPoolReverts() public {
        vm.expectRevert(abi.encodeWithSelector(PredictionPool.PoolNotFound.selector, 7));
        _report(7, true);
    }

    function test_supportsInterface() public view {
        assertTrue(pool.supportsInterface(type(IReceiver).interfaceId));
        assertTrue(pool.supportsInterface(type(IERC165).interfaceId));
        assertFalse(pool.supportsInterface(0xffffffff));
    }
}
