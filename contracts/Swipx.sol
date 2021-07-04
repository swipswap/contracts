// SPDX-License-Identifier: MIT

pragma solidity >= 0.5.0 < 0.8.0;

import "./ERC20Token.sol";


contract Swipx is TOEKN {
    
    uint256 private _stakeUnit = 10000;
    mapping (address => uint256) private _balances;
    // mapping(address => uint256) private stakeIndex;
    // uint256 private _stakers;
    event WithdrawStake(address indexed staker, uint256 indexed amount);
    
    using SafeMath for uint256;
    using Address for address;

    event StakeAdded(address account, uint256 stakes);
    event StakeUpdated(address account, uint256 stakes);
    event PaymentReleased(address to, uint256 amount);
    event PaymentReceived(address from, uint256 amount);

    uint256 private _totalStakes;
    uint256 private _totalReleased;

    mapping(address => uint256) private _stakes;
    mapping(address => uint256) private _released;
    address[] private _stakers;

    constructor() TOEKN("SWIPX", "SWIPX", 1000000000 * 10 ** 3) public {}
    
    function _addPayee(address account, uint256 stakes_) private {
        require(account != address(0), "PaymentSplitter: account is the zero address");
        require(stakes_ > 0, "PaymentSplitter: shares are 0");
        require(_stakes[account] == 0, "PaymentSplitter: account already has shares");
        _stakers.push(account);
        _stakes[account] = stakes_;
        _totalStakes = _totalStakes.add(stakes_);
        emit StakeAdded(account, stakes_);
    }
    
    function totalStakes() public view returns (uint256) {
        return _totalStakes;
    }
    
    function totalReleased() public view returns (uint256) {
        return _totalReleased;
    }
    
    function release(address payable account) public virtual {
        require(_stakes[account] > 0, "PaymentSplitter: account has no shares");

        uint256 totalReceived = address(this).balance.add(_totalReleased);
        uint256 payment = totalReceived.mul(_stakes[account]).div(_totalStakes).sub(_released[account]);

        require(payment != 0, "PaymentSplitter: account is not due payment");

        _released[account] = _released[account].add(payment);
        _totalReleased = _totalReleased.add(payment);

        account.transfer(payment);
        emit PaymentReleased(account, payment);
    }
    
    function squashShares() internal virtual {
        address sender = msg.sender; 
        uint256 accountStakes = _stakes[sender];
        _totalStakes -= accountStakes;
        for (uint256 i = 0; i<_stakers.length; i++){
            if(_stakers[i] == sender) {
                if(_stakers.length > 0) {
                    _stakers[i] = _stakers[_stakers.length-1];
                    delete _stakers[_stakers.length-1];
                }
                delete _stakers[i];
                _stakes[msg.sender] = 0;
                break;
            }
        }
    }
    
    function _updatePayee(address account, uint256 stakes_) internal virtual {
        require(account != address(0), "PaymentSplitter: account is the zero address");
        require(stakes_ > 0, "PaymentSplitter: shares are 0");
        require(_stakes[account] > 0, "PaymentSplitter: Account has no privious shares");
        require(msg.sender == account);
        _stakes[account] = stakes_;
        _totalStakes = stakes_;
        emit StakeUpdated(account, stakes_);
    }
    
    function stake(uint256 amount) payable public returns (bool success) {
        require(amount.mod(_stakeUnit) == 0, 'You can only stake a multiple of 1000 tokens');
        // calculate stakes
        uint256 stakes = amount.div(_stakeUnit);
        transfer(address(this), amount);
        _balances[msg.sender] = amount;
        _addPayee(msg.sender, stakes);
        return true;
    }
    
    
       function stakes(address account) public view returns (uint256) {
        return _stakes[account];
    }

 
    function released(address account) public view returns (uint256) {
        return _released[account];
    }

    function staker(uint256 index) public view returns (address) {
        return _stakers[index];
    }
    
    receive () external payable virtual {
        emit PaymentReceived(_msgSender(), msg.value);
    }
    
    function withdrawStake() public {
        address payable sender = msg.sender;
        require(_balances[sender] > 0, "You currently have 0 withdrawable balance");
        uint256 previousAmount = _balances[sender];
        _balances[sender] = 0;
        squashShares();
        Swipx(address(this)).transfer(sender, previousAmount);
        emit WithdrawStake(sender, previousAmount);
    }
    
    function myStakes() public view returns(uint256) {
        return stakes(msg.sender);
    }
}
