// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";

/// FR-C-07: no admin override of outcome or user funds. The compiled ABI may expose only the five
/// state-changing entry points below; anything else (owner, pause, setOutcome, withdraw...) fails.
contract NoAdminTest is Test {
    string internal constant ARTIFACT = "out/PredictionPool.sol/PredictionPool.json";

    function test_onlyExpectedStateChangingFunctions() public view {
        string memory json = vm.readFile(ARTIFACT);
        uint256 mutating;
        for (uint256 i = 0; vm.keyExistsJson(json, _key(i, "")); i++) {
            if (!_eq(vm.parseJsonString(json, _key(i, ".type")), "function")) continue;
            string memory mutability = vm.parseJsonString(json, _key(i, ".stateMutability"));
            if (_eq(mutability, "view") || _eq(mutability, "pure")) continue;
            string memory name = vm.parseJsonString(json, _key(i, ".name"));
            assertTrue(_allowed(name), string.concat("unexpected state-changing function: ", name));
            mutating++;
        }
        assertEq(mutating, 5);
    }

    function _allowed(string memory name) private pure returns (bool) {
        return _eq(name, "createPool") || _eq(name, "stake") || _eq(name, "claim") || _eq(name, "refund")
            || _eq(name, "onReport");
    }

    function _key(uint256 i, string memory suffix) private pure returns (string memory) {
        return string.concat(".abi[", vm.toString(i), "]", suffix);
    }

    function _eq(string memory a, string memory b) private pure returns (bool) {
        return keccak256(bytes(a)) == keccak256(bytes(b));
    }
}
