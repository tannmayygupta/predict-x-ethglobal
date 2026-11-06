// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";

/// @notice Chainlink CRE consumer interface. The KeystoneForwarder checks ERC-165 support for this
/// interface before it delivers a report, so implementers must also answer supportsInterface.
/// Shape copied from docs.chain.link/cre (building consumer contracts).
interface IReceiver is IERC165 {
    function onReport(bytes calldata metadata, bytes calldata report) external;
}
