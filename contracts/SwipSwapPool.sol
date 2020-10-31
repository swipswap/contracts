// SPDX-License-Identifier: MIT
pragma solidity >0.6.0;

import "@chainlink/contracts/src/v0.6/ChainlinkClient.sol";

/** @title Token abstract. */
contract Token {
    function transfer(address _to, uint256 _value) public returns (bool success) {}
    function balanceOf(address account) public view returns (uint256){}
    function transferFrom(address from, address to, uint tokens) public returns (bool success){}
}

/** @title EventEmitter abstract. */
contract EventEmitter {
    function emitFulfill(uint256 _requestId) public returns (bool) {}
}

/** @title SwipSwapPool Contract. */
contract SwipSwapPool is ChainlinkClient {
    
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
    uint256 public tokendecimals;
    uint256 public rate;
    
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
    
    constructor(address _chainlinkToken, address _oracle, bytes32 _jobID) public {
        setChainlinkToken(_chainlinkToken);
        oracle = _oracle;
        jobId = _jobID;
        fee = 0.1 * 10 ** 18; // 0.1 LINK
        rate = 13000;
    }
    
    /** @dev Initializes a pool after the contract has been deployed by the factory.
      * @param _initiator Address of the account that initiates the pool.
      * @param _token contract Address of the token the pool is being created for.
      * @param _coindecimals Decimals of the token being added.
      * @param _eventEmitter Address of the eventEmitter contract.
      */
    function initialize(address payable _initiator, address _token, uint256 _coindecimals, uint256 _tokendecimals, address _eventEmitter) public {
        deployer = msg.sender; // this should be the deploying contract
        initiator = _initiator;
        token = Token(_token);
        coindecimals = _coindecimals;
        tokendecimals = _tokendecimals;
        eventEmitter = _eventEmitter;
        
        emit PoolInitialized(msg.sender, _initiator, _token);
    }
    
    /** @dev Transfers token.
      * @param _sender Address of the account sending the token.
      * @param _token Contract Address of the token being added.
      * @param _amount Amount of token to be transerred.
      */
    function transferToken(address _sender, address _token, uint256 _amount) private {
        if(_token == address(0)){
            require(_amount == msg.value);
        }else {
            require(Token(_token).transferFrom(_sender, address(this), _amount));
        }
    }
    
    /** @dev Transfers token out of the SwipSwapPool smart contract.
      * @param _to Address where to token is being transferred to.
      * @param _amount The amount of tokens to be transferred.
      */
    function transferTokenOut(address payable _to, uint256 _amount) private {
        if(address(token) == address(0)){
            _to.transfer(_amount);
        }else {
            require(Token(token).transfer(_to, _amount));
        }
    }

    /** @dev Set a new exchange rate
        @param _newRate New exchange rate
     */
    function setRate(uint256 _newRate) private {
        rate = _newRate;
    }
    
    /** @dev Sets address of the eventEmitter.
      * @param _eventEmitter Address of the event emitter contract.
      */
    function setEventEmitterAddress(address _eventEmitter) public {
        eventEmitter = _eventEmitter;
    }
    
    /** @dev Sets byte32 value of the jobID variable.
      * @param _jobID the jobID.
    */
    function setJobID(bytes32 _jobID) public onlyOwner() {
        jobId = _jobID;
    }
    
    
    /** @dev Enables an account to join an existing pool.
      * @param _amount The amount of token an account wants to contribute to the pool.
      * @param _pubkey A deterministic public key address such as bitcoin xpub which will be used to compute the external addresses for transactions in the pool
      * @param _token The address of the token the account wants to add to the pool.
    */    
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
        
        emit PoolJoined(_sender, _amount);
        return true;
    }
    
    
    /** @dev Gets the details of a given pool.
      * @param _poolAddress returns the address.
      * @return pubkey The pubkey associated with the pool.
      * @return index The index location of the pool in the SwipSwap contract.
      * @return initAmount The amount used to initialize the pool.
      * @return unlockedAmount The amount already unlocked from the pool.
      * @return lockedAmount The amount still available in the pool.
      * @return filledAmount the amount that has already been filled in the pool.
    */
    
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
    
    
    /** @dev Gets the detail of a specific locked amount created for a pool.
      * @param _poolAddress The Address of the pool.
      * @param _index The index of the pool.
      * @return locker Address of the account that created this lock.
      * @return expBlock The block number that this lock is set to expire.
      * @return tokenAmount The amounts of token that is locked.
      * @return isCancelled Boolean showing whether this lock has been canceled.
      * @return isFinalised Boolean showing whether this lock has been finalized.
      * @return isPaid Boolean showing whether this lock has been paid and waiting for finalization.
    */
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
    
    // function newLock( bytes32 _data, address _poolAddress, uint256 _index, uint256 _amount, address _token)\
    /** @dev Creates a new lock from an existing pool address.
      * @param _token Address of the token the lock is being created for.
      * @param _poolAddress The Address of the pool the lock is being associated with.
      * @param _index The index of the pool.
      * @return true
    */
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
        uint256 _tokenAmount = (_coinAmount * rate * 10**(tokendecimals+18 - coindecimals)) / 10**18;
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
        emit NewLock(_sender, _poolAddress, nextIndex, _tokenAmount);
        return true;
    }
    
    /**
     * 0 => withdraw
     * 1 => predefinedCall
     * 2 => uniswap
     * 
    **/
    /** @dev Gets the detail of a specific locked amount created for a pool.
      * @param _callData (optional) Contains customized instructions such as "external call to uniswap smart contract".
      * @param _lockAddress The address that created the lock.
      * @param _predefinedCall Some predefined instructions available.
      * @param _callContractAddress (optional) If callData exists, specify the external contract to be called.
      * @param _indexStr index of the lock === index of the address paid to in a lock.
      * @param _index The number format of the index of the lock.
      * @return success
    */
    function fulfillLock(
        bytes memory _callData, //deposit,addresses
        address _lockAddress,
        uint256 _predefinedCall,
        address _callContractAddress,
        string memory _indexStr, // to be reviewed
        uint256 _index // to be reviewed
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
        
        emit FulfillLock(msg.sender, _lockAddress, _index, _lock.tokenAmount, _requestId);
        return true;
    }

    /** @dev Changes the status of a lock to fulfilled
      * @param _requestId will be provided by the calling chainlink node.
      * @param total_received The amount received for the lock.
    */  
    function fulfill(bytes32 _requestId, uint256 total_received) public recordChainlinkFulfillment(_requestId) // Only chainlink node should call this
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
    
    /** @dev Finalizes a lock directive.
      * @param _fulfillReqCount an identifier generated by this contract, sent to the node and supplied by the chain link node.
    */      
    function finaliseLock(uint256 _fulfillReqCount) public returns (bool) { // Not fully implemented
        Lock memory _lock = pendingPaymentIndexLock[_fulfillReqCount];
        require(_lock.isPaid, ": Payment has not been confirmed");
        require(!_lock.isFinalised, ": Payment has already been finalised");
        _lock.isFinalised = true;
        if(_lock.predefinedCall == 0){
            transferTokenOut(_lock.locker, _lock.tokenAmount);
        }
        pendingPaymentIndexLock[_fulfillReqCount] = _lock;
        locks[_lock.lockAddress][_lock.index] = _lock;
    }

    /** @dev Gets the id of the finaliseLock function.
      * @return _selector The result in bytes.
    */  
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