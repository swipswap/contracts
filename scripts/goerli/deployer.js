// init nodes by running docker-compose up
// wait for 10 secs for nodes to be started
// deploy contracts: 

const ethers = require("ethers")
const axios = require("axios")
const config = require("../../goerli_node/config/config.json")
const getAddressJob = require("../../goerli_node/config/getbalance.spec.json")
const paymentJob = require("../../goerli_node/config/finalize.spec.json")
const { tokenABI, oracleABI } = require("../../prebuild/abi")
const { tokenBytecode, oracleBytecode } = require("../../prebuild/bytecodes")

const {abi: erc20TokenABI, bytecode: erc20TokenBytecode} = require("../../artifacts/contracts/ERC20Token.sol/TOEKN.json")
const {abi: eventEmitterABI, bytecode: eventEmitterBytecode} = require("../../artifacts/contracts/SwipSwapEventEmitter.sol/SwipSwapEventEmitter.json")
const {abi: swipswapABI, bytecode: swipswapBytecode} = require("../../artifacts/contracts/SwipSwapPool.sol/SwipSwapPool.json")
const {abi: swipTokenABI, bytecode: swipTokenBytecode} = require("../../artifacts/contracts/SwipToken.sol/SwipToken.json")

const connectAndGetProvider = async () => {
    const provider = new ethers.providers.AlchemyProvider('goerli', '9GJ40fZ1PGwqID6jUHOyzdyEsPLqE7Kn')
    return provider
}

const getKnownSigner = async (provider) => {
    const knownSigner = ethers.Wallet.fromMnemonic(config.mnemonic).connect(provider)
    return knownSigner
}

const deployChainlinkToken = async (signer) => {
    const factory = new ethers.ContractFactory(tokenABI, tokenBytecode, signer)
    const contract = await factory.deploy()
    contract.deployTransaction.wait()
    return contract
}

const deployFUSDToken = async (signer) => {
    const factory = new ethers.ContractFactory(erc20TokenABI, erc20TokenBytecode, signer)
    const contract = await factory.deploy("Fake USD","FUSD", 1_000_000_000)
    contract.deployTransaction.wait()
    return contract
}

const deployEventEmitter = async (signer) => {
    const factory = new ethers.ContractFactory(eventEmitterABI, eventEmitterBytecode, signer)
    const contract = await factory.deploy()
    contract.deployTransaction.wait()
    return contract
}

const deploySwipswapContract = async (chainlinkTokenAddress, oracleAddress, jobID, signer) => {
    const factory = new ethers.ContractFactory(swipswapABI, swipswapBytecode, signer)
    const contract = await factory.deploy(chainlinkTokenAddress, oracleAddress, jobID)
    contract.deployTransaction.wait()
    return contract
}

const setupChainlinkOracle = async (signer, linkToken, nodeAddress) => {
    const factory = new ethers.ContractFactory(oracleABI, oracleBytecode, signer)
    const contract = await factory.deploy(linkToken)
    contract.deployTransaction.wait()
    await contract.setFulfillmentPermission(nodeAddress, true)
    return contract
}

const deploySWIPToken = async (signer) => {
    const factory = new ethers.ContractFactory(swipTokenABI, swipTokenBytecode, signer)
    const contract = await factory.deploy(10_000, 1_000_000_000)
    contract.deployTransaction.wait()
    return contract
}

const sleep = (seconds) => {
    return new Promise(resolve => setTimeout(resolve, seconds*1000));
}

const getNodeAddress = async (delay=5) =>{
    const queryNodeAddress = async () => {
        try {
            let res = await axios.post("http://localhost:6688/sessions", {email:"user@mail.com", password:"password"}, {withCredentials: true})
            res = await axios.get("http://localhost:6688/v2/user/balances", {headers: {Cookie: res.headers['set-cookie'].join("; ")}})
            const nodeAddress = res.data.data[0].id
            return nodeAddress
        } catch (error) {
            console.log(error.message)
        }
        return ""
    }

    let count = 0

    while(!await queryNodeAddress()){
        if(count === 10){
            console.log("unable to get chainlink node address")
            break
        }
        await sleep(delay)
        count++
        console.log("attempting to get node address...")
    }
    return await queryNodeAddress()
}

const main = async (callbackFunction=()=>{}) => {
    let _store = {}
    await sleep(5)
    const provider = await connectAndGetProvider()
    const knownSigner = await getKnownSigner(provider)

    const chainlinkToken = await deployChainlinkToken(knownSigner)
    console.log("deployed chainlink token")

    const nodeAddress = await getNodeAddress()
    if(nodeAddress === ""){
        return
    }
    
    console.log("Setting up chainlink oracle...")
    const chainlinOracle = await setupChainlinkOracle(knownSigner, chainlinkToken.address, nodeAddress)
    console.log("Successful!")

    _store = {..._store, chainlinkToken, provider, knownSigner, chainlinOracle, nodeAddress}

    await callbackFunction(_store)
}

const authenticate = async() => {
    let res = await axios.post("http://localhost:6688/sessions", {email:"user@mail.com", password:"password"}, {withCredentials: true})
    return res
}


const callbackFunction = async (store) => {
    const knownSigner = store.knownSigner
    const chainlinkTokenAddress = store.chainlinkToken.address
    const chainlinOracleAddress = store.chainlinOracle.address

    const fusdContract = await deployFUSDToken(knownSigner)
    console.log("Deployed fusd token")
    const fusdContractAddress = fusdContract.address
    await fusdContract.transfer(config.testAddress, '500000000')

    const eventEmitterContract = await deployEventEmitter(knownSigner)
    console.log("Deployed event emitter")
    const eventEmitterAddress = eventEmitterContract.address
    
    const authRes = await authenticate()
    const headers = { Cookie: authRes.headers['set-cookie'].join("; ") }

    const bridge = require("./config/bridge.json")
    const bridgeRes = await axios.post("http://localhost:6688/v2/bridge_types", bridge,{ headers })
    const bridgeID = bridgeRes.data.data.id
    
    getAddressJob.initiators[0].params.address = chainlinOracleAddress
    const getAddressJobRes = await axios.post("http://localhost:6688/v2/specs", getAddressJob,{ headers })
    const getAddressJobID = getAddressJobRes.data.data.id
    
    const swipswapContract = await deploySwipswapContract(chainlinkTokenAddress, chainlinOracleAddress, ethers.utils.toUtf8Bytes(getAddressJobID), knownSigner)
    console.log("Deployed swipswap pool")
    const swipswapAddress = swipswapContract.address
    await swipswapContract.initialize(config.testAddress, fusdContractAddress, 8, 3, eventEmitterAddress)
    await store.chainlinkToken.transfer(swipswapAddress,ethers.utils.parseEther("1000"))

    paymentJob.initiators[0].params.address = eventEmitterAddress
    paymentJob.tasks[2].params.address = swipswapAddress

    const paymentJobRes = await axios.post("http://localhost:6688/v2/specs", paymentJob, { headers })
    const paymentJobID = paymentJobRes.data.data.id

    const swipTokenContract = await deploySWIPToken(knownSigner)
    console.log('Deployed SWIP')
    const swipTokenContractAddress = swipTokenContract.address
    await swipTokenContract.transfer(config.testAddress, 1_000_000_000)

    console.log({
        chainlinkTokenAddress,
        chainlinOracleAddress,
        nodeAddress:    store.nodeAddress,
        fusdContractAddress,
        eventEmitterAddress,
        bridgeID,
        paymentJobID,
        swipswapAddress,
        swipTokenContractAddress
    })
}

// main(callbackFunction)
module.exports = {
    setupNode: main,
    callbackFunction,
    connectAndGetProvider,
    getKnownSigner,
    deployChainlinkToken,
    deployFUSDToken,
    deployEventEmitter,
    deploySwipswapContract,
    setupChainlinkOracle,
    sleep,
    getNodeAddress,
    authenticate,
}
