// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {MockUSDC} from "../src/MockUSDC.sol";

contract MockUSDCTest is Test {
    uint256 internal constant MAX_MINT = 1_000e6;
    MockUSDC internal usdc;
    address internal alice = makeAddr("alice");

    function setUp() public {
        usdc = new MockUSDC();
    }

    function test_metadata() public view {
        assertEq(usdc.name(), "Mock USDC");
        assertEq(usdc.symbol(), "USDC");
        assertEq(usdc.decimals(), 6);
    }

    function test_mint_anyoneUpToCap() public {
        vm.prank(alice);
        usdc.mint(alice, MAX_MINT);
        assertEq(usdc.balanceOf(alice), MAX_MINT);
        assertEq(usdc.MAX_MINT_PER_CALL(), MAX_MINT);
    }

    function test_mint_aboveCapReverts() public {
        vm.expectRevert(abi.encodeWithSelector(MockUSDC.MintCapExceeded.selector, MAX_MINT + 1, MAX_MINT));
        usdc.mint(alice, MAX_MINT + 1);
    }

    function test_approveAndAllowance() public {
        vm.prank(alice);
        assertTrue(usdc.approve(address(this), 5e6));
        assertEq(usdc.allowance(alice, address(this)), 5e6);
    }
}
