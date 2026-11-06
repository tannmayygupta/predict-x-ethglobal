// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {MockUSDC} from "../src/MockUSDC.sol";
import {PredictionPool} from "../src/PredictionPool.sol";

/// Deploys MockUSDC, then PredictionPool(usdc, forwarder, treasury).
/// Env: DEPLOYER_PRIVATE_KEY, TREASURY_ADDRESS, KEYSTONE_FORWARDER_ADDRESS (see contracts/README.md).
contract Deploy is Script {
    function run() external returns (MockUSDC usdc, PredictionPool pool) {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address treasury = vm.envAddress("TREASURY_ADDRESS");
        address forwarder = vm.envAddress("KEYSTONE_FORWARDER_ADDRESS");

        vm.startBroadcast(deployerKey);
        usdc = new MockUSDC();
        pool = new PredictionPool(address(usdc), forwarder, treasury);
        vm.stopBroadcast();

        console2.log("chainId", block.chainid);
        console2.log("MockUSDC", address(usdc));
        console2.log("PredictionPool", address(pool));
        console2.log("forwarder", forwarder);
        console2.log("treasury", treasury);
    }
}
