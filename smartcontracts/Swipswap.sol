pragma solidity ^0.6.0;

// SPDX-License-Identifier: MIT
import "https://raw.githubusercontent.com/smartcontractkit/chainlink/develop/evm-contracts/src/v0.6/ChainlinkClient.sol";


contract Token {
    function transfer(address _to, uint256 _value) public returns (bool success) {}
    function balanceOf(address account) public view returns (uint256){}
    function transferFrom(address from, address to, uint tokens) public returns (bool success){}
}

contract EventEmitter {
    function emitFulfill(uint256 _requestId) public returns (bool) {}
}

contract SwipSwap is ChainlinkClient {
    
    event PoolInitialized(address indexed _deployer, address indexed _initiator, address indexed _token);
    event PoolJoined(address indexed _poolOwner, uint256 _amount);
    event NewLock(address indexed _locker, address indexed _poolAddress, uint256 _index, uint256 _amount);
    event FulfillLock(address indexed _locker, address indexed _lockAddress, uint256 _index, uint256 _amount, bytes32 _requestID);
    event Fulfill(string _requestId);
    
    address private oracle;
    bytes32 private jobId;
    uint256 private fee;
    bool private initialized;
    
    uint256 public coindecimals;
    
    address payable public initiator;
    address payable public deployer;
    address public eventEmitter;
    Token public token;
    
    uint256 public fulfillReqCount;
    
    struct Pool {
        string pubkey;
        uint256 index;
        uint256 initAmount;
        uint256 unlockedAmount;
        uint256 lockedAmount;
        uint256 filledAmount;
        bool isLocked;
    }
    
    struct Lock {
        address payable locker;
        uint256 expBlock;
        uint256 coinAmount;
        uint256 tokenAmount;
        bool isCancelled;
        bool isPaid;
        bool isFinalised;
        // bytes32 data;
        address lockAddress;
        uint256 index;
        uint256 predefinedCall;
        address callContractAddress;
        bytes callData;
    }
    
    mapping (address => Pool) pools;
    mapping (address => mapping (uint256 => Lock)) locks;
    mapping (uint256 => Lock) pendingPaymentIndexLock;
    mapping (bytes32 => uint256) requestIdFulfillReqCount;
    
    constructor() public {
        setChainlinkToken(0x87AE97F105Eba72E3B26dBB27B09bDE5943Df2bD);
        oracle = 0xDccc8028CFB3f8d489719bBFC7389b00b3D4AFC3;
        jobId = "387c3a2344e04c398587afd13f50cea5";
        fee = 0.1 * 10 ** 18; // 0.1 LINK
    }
    
    function initiaze(address payable _initiator, address _token, uint256 _coindecimals, address _eventEmitter) public {
        deployer = msg.sender; // this should be the deploying contract
        initiator = _initiator;
        token = Token(_token);
        coindecimals = _coindecimals;
        eventEmitter = _eventEmitter;
        
        PoolInitialized(msg.sender, _initiator, _token);
    }
    
    function transferToken(address _sender, address _token, uint256 _amount) private {
        if(_token == address(0)){
            require(_amount == msg.value);
        }else {
            require(Token(_token).transferFrom(_sender, address(this), _amount));
        }
    }
    
    function transferTokenOut(address payable _to, uint256 _amount) private {
        if(address(token) == address(0)){
            _to.transfer(_amount);
        }else {
            require(Token(token).transfer(_to, _amount));
        }
    }
    
    function setEventEmitterAddress(address _eventEmitter) public {
        eventEmitter = _eventEmitter;
    }
    
    function setJobID(bytes32 _jobID) public {
        jobId = _jobID;
    }
    
    function joinPool(uint256 _amount, string memory _pubkey, address _token) onlyInitToken(_token)  public payable returns (bool) {
        require(pools[msg.sender].index == 0, ": Pool already exist");
        address payable _sender = msg.sender;
        transferToken(_sender, _token, _amount);
        Pool memory newPool = Pool({
            pubkey: _pubkey,
            index: 1,
            initAmount: _amount,
            unlockedAmount: 0,
            lockedAmount: _amount,
            filledAmount: 0,
            isLocked: false
        });
        pools[_sender] = newPool;
        Lock memory newLock = Lock({
            locker: _sender,
            expBlock: block.number - 1, // this should be changed
            tokenAmount: _amount,
            coinAmount: 0,
            isCancelled: false,
            isPaid: false,
            isFinalised: false,
            // data: 0x0
            lockAddress: _sender,
            index: 1,
            predefinedCall: 0,
            callContractAddress: address(0),
            callData: ""
        });
        locks[_sender][1] = newLock;
        
        PoolJoined(_sender, _amount);
        return true;
    }
    
    function getPoolDetails(address _poolAddress) public view returns (
            string memory pubkey,
            uint256 index,
            uint256 initAmount,
            uint256 unlockedAmount,
            uint256 lockedAmount,
            uint256 filledAmount,
            bool isLocked
        ) {
        Pool memory _pool = pools[_poolAddress];
        pubkey = _pool.pubkey;
        index = _pool.index;
        initAmount = _pool.initAmount;
        unlockedAmount = _pool.unlockedAmount;
        lockedAmount = _pool.lockedAmount;
        filledAmount = _pool.filledAmount;
        isLocked = _pool.isLocked;
    }
    
    function getLockDetails(address _poolAddress, uint256 _index) public view returns (
            address locker,
            uint256 expBlock,
            uint256 tokenAmount,
            bool isCancelled,
            bool isFinalised,
            bool isPaid
        ){
            Lock memory _lock = locks[_poolAddress][_index];
            locker = _lock.locker;
            expBlock = _lock.expBlock;
            tokenAmount = _lock.tokenAmount;
            isCancelled = _lock.isCancelled;
            isFinalised = _lock.isFinalised;
            isPaid = _lock.isPaid;
            // data = _lock.data;
    }
    
    // function newLock( bytes32 _data, address _poolAddress, uint256 _index, uint256 _amount, address _token)
    function newLock(address _token, address _poolAddress, uint256 _index, uint256 _coinAmount) // 1btc => 100eth | 100*10**18 | 1*10**7 => 100*10**(18-8) => 10*10**18
    public
    payable
    onlyReusableLock(_poolAddress, _index)
    onlyInitToken(_token)
    returns (bool) {
        Pool memory _pool = pools[_poolAddress];
        uint256 nextIndex;
        require(!_pool.isLocked, ": Pool is locked by the owner");
        address payable _sender = msg.sender;
        uint256 _tokenAmount = _coinAmount * 100 * 10**(18-coindecimals); // 0.0010000 btc = 100eth  ==> (1 * 10**8)/10**8) * rate(100 eth/btc) * 10**(18) ==> 100 * 10**18
        // transferToken(_sender, _token, _tokenAmount);
        if (_index == 0){ // create newLock from balance
            require(_pool.unlockedAmount >= _tokenAmount, ": Insufficient pool balance");
            _pool.unlockedAmount = _pool.unlockedAmount - _tokenAmount;
            
        }else {
            // use existing lock
            Lock memory _lock = locks[_poolAddress][_index];
            require(_lock.tokenAmount >= _tokenAmount, ": Insufficient lock balance");
            require(_lock.expBlock < block.number, ": Block has not expired");
            _pool.unlockedAmount = _pool.unlockedAmount + (_lock.tokenAmount - _tokenAmount);
            _lock.isCancelled = true;
            locks[_poolAddress][_index] = _lock;
        }
        nextIndex = _pool.index + 1;
        _pool.index = nextIndex;
        pools[_poolAddress] = _pool;
        
        Lock memory _newLock = Lock({
            locker: _sender,
            expBlock: block.number + 3, // this should be changed
            coinAmount: _coinAmount, // amount of btc should be supplied and amount of token should be calculated and stored
            tokenAmount: _tokenAmount, 
            isCancelled: false,
            isPaid: false,
            isFinalised: false,
            // data: _data
            lockAddress: _poolAddress,
            index: nextIndex,
            predefinedCall: 0,
            callContractAddress: address(0),
            callData: ""
        });
        locks[_poolAddress][nextIndex] = _newLock;
        NewLock(_sender, _poolAddress, nextIndex, _tokenAmount);
        return true;
    }
    
    /**
     * 0 => withdraw
     * 1 => predefinedCall
     * 2 => uniswap
     * 
    **/
    
    function fulfillLock(
        bytes memory _callData, //deposit,addresses
        address _lockAddress,
        uint256 _predefinedCall,
        address _callContractAddress,
        string memory _indexStr,
        uint256 _index
    )
    public
    onlyLoker(_lockAddress, _index) // is this necessary?
    onlyFinaliseableLock(_lockAddress, _index)
    returns (bool success){
        // ensure link token balance is sufficient

        Lock memory _lock = locks[_lockAddress][_index];
        Pool memory _pool = pools[_lockAddress];
        _lock.callData = _callData;
        _lock.predefinedCall = _predefinedCall;
        _lock.callContractAddress = _callContractAddress;
        // paymentIndex++;
       
        Chainlink.Request memory request = buildChainlinkRequest(jobId, address(this), this.fulfill.selector);
        request.add("index", _indexStr);
        request.add("explorer", "blockcypher");
        request.add("pubKey", _pool.pubkey);
        bytes32 _requestId = sendChainlinkRequestTo(oracle, request, fee);
        
        fulfillReqCount++;
        requestIdFulfillReqCount[_requestId] = fulfillReqCount;
        pendingPaymentIndexLock[fulfillReqCount] = _lock;
        
        FulfillLock(msg.sender, _lockAddress, _index, _lock.tokenAmount, _requestId);
        return true;
    }
    
    function fulfill(bytes32 _requestId, uint256 total_received) public recordChainlinkFulfillment(_requestId)
    {
        // only chainlink node should call this function
        uint256 _fulfillReqCount = requestIdFulfillReqCount[_requestId];
        Lock memory _lock = pendingPaymentIndexLock[_fulfillReqCount];
        if(total_received >= _lock.coinAmount){
            _lock.isPaid = true;
            pendingPaymentIndexLock[_fulfillReqCount] = _lock;
            locks[_lock.lockAddress][_lock.index] = _lock;
            Pool memory _pool = pools[_lock.lockAddress];
            _pool.filledAmount += _lock.tokenAmount;
            pools[_lock.lockAddress] = _pool;

            // Fulfill(_requestIdStr);
            EventEmitter(eventEmitter).emitFulfill(_fulfillReqCount);
        }
        
    }
    
    function finaliseLock(uint256 _fulfillReqCount) public returns (bool) {
        Lock memory _lock = pendingPaymentIndexLock[_fulfillReqCount];
        require(_lock.isPaid, ": Payment has not been confirmed");
        require(!_lock.isFinalised, ": Payment has already been finalised");
        _lock.isFinalised = true;
        if(_lock.predefinedCall == 0){
            _lock.locker.transfer(_lock.tokenAmount);
            transferTokenOut(_lock.locker, _lock.tokenAmount);
        }
        pendingPaymentIndexLock[_fulfillReqCount] = _lock;
        locks[_lock.lockAddress][_lock.index] = _lock;
    }
    
    function finaliseLockSelector() public pure returns (bytes4 _selector) {
        return this.finaliseLock.selector;
    }
    
    
    function cancelLock() public {}
    function lockPool() public {}
    function increasePoolAmount() public {}
    function withdrawPool() public{}

    modifier onlyInitToken(address _token) {
        require(address(token) == _token, ": Token not supported");
        _;
    }
    
    modifier onlyOwner() {
        require(deployer == msg.sender, ": caller is not the owner");
        _;
    }
    
    modifier onlyLoker(address _lockPool, uint256 _index) {
        require(msg.sender == getLocker(_lockPool, _index), ": caller is not the locker");
        _;
    }
    
    modifier onlyReusableLock(address _lockPool, uint256 _index) {
        Lock memory lock = locks[_lockPool][_index];
        require(lock.expBlock < block.number, "Block has not expired");
        require(!lock.isFinalised, ": lock is already finalised");
        require(!lock.isCancelled, ": lock is isCancelled");
        _;
    }
    
    modifier onlyFinaliseableLock(address _lockPool, uint256 _index) {
        Lock memory lock = locks[_lockPool][_index];
        require(lock.expBlock > block.number, "Block has expired");
        require(!lock.isFinalised, ": lock is already finalised");
        require(!lock.isCancelled, ": lock is isCancelled");
        _;
    }
    
    modifier onlyNonFinalisedLock(address _lockPool, uint256 _index) {
        Lock memory lock = locks[_lockPool][_index];
        require(!lock.isFinalised, ": lock is already finalised");
        _;
    }
    
    function getLocker(address _lockPool, uint256 _index) public view returns (address locker) {
        return (locks[_lockPool][_index]).locker;
    }
    
    function getZeroAddress() public pure returns (address) {
        return address(0);
    }
    
    function bytes32ToString(bytes32 _bytes32) public pure returns (string memory) {
        uint8 i = 0;
        while(i < 32 && _bytes32[i] != 0) {
            i++;
        }
        bytes memory bytesArray = new bytes(i);
        for (i = 0; i < 32 && _bytes32[i] != 0; i++) {
            bytesArray[i] = _bytes32[i];
        }
        return string(bytesArray);
    }
    
    function stringToBytes32(string memory source) public pure returns (bytes32 result) {
        bytes memory tempEmptyStringTest = bytes(source);
        if (tempEmptyStringTest.length == 0) {
            return 0x0;
        }

        assembly { // solhint-disable-line no-inline-assembly
            result := mload(add(source, 32))
        }
    }

}
