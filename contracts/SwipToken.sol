// SPDX-License-Identifier: MIT

pragma solidity >0.6.0;

import "./ERC20Token.sol";


contract SwipToken is TOEKN {
    constructor() public TOEKN("SWIP", "SWIP", 1000000000 * 10 ** 3) {}
}