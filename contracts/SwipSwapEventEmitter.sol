pragma solidity >0.6.0;

// SPDX-License-Identifier: MIT

contract SwipSwapEventEmitter {
    event Fulfill(uint256 _requestId);
    
    function emitFulfill(uint256 _requestId) public returns (bool) {
        emit Fulfill(_requestId);
        return true;
    }
    
    function emitFulfillSelector() public pure returns (bytes4 _selector) {
        return this.emitFulfill.selector;
    }
}
