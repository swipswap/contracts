// init nodes by running docker-compose up
// wait for 10 secs for nodes to be started
// deploy contracts: 

const ethers = require("ethers")
const axios = require("axios")
const config = require("./config/config.json")
const { tokenABI, oracleABI, erc20TokenABI, eventEmitterABI, swipswapABI } = require("./prebuild/abi")
const { tokenBytecode, oracleBytecode } = require("./prebuild/bytecodes")
const swipswapBytecode = require("./prebuild/swipswap")
const erc20TokenBytecode = require("./prebuild/token")
const eventEmitterBytecode = require("./prebuild/eventEmitter")


const connectAndGetProvider = async () => {
    const provider = new ethers.providers.JsonRpcProvider("http://0.0.0.0:6690")
    return provider
}

const getKnownSigner = async (provider) => {
    const knownSigner = ethers.Wallet.fromMnemonic(config.mnemonic).connect(provider)
    return knownSigner
}

const getAddressFunder = (provider, startingIndex=2) => {
    let currentIndex = startingIndex
    return async (address, etherValue=80) => {
        try {
            console.log("funding ====================>>>",{address})
            await provider.getSigner(currentIndex).sendTransaction({
                value: ethers.utils.parseEther(String(etherValue)),
                to: address
            })
            currentIndex +=1
        } catch (error) {
            console.log("error funding address", error)
        }
    }
}

const deployChainlinkToken = async (signer) => {
    const factory = new ethers.ContractFactory(tokenABI, tokenBytecode, signer)
    const contract = await factory.deploy()
    contract.deployTransaction.wait()
    return contract
}

const deployTUSDToken = async (signer) => {
    const factory = new ethers.ContractFactory(erc20TokenABI, erc20TokenBytecode, signer)
    const contract = await factory.deploy("Test USD","TUSD", 1_000_000_000)
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
    const fundAddress = getAddressFunder(provider)
    await fundAddress(await knownSigner.getAddress())
    await fundAddress(config.testAddress)

    const chainlinkToken = await deployChainlinkToken(knownSigner)

    const nodeAddress = await getNodeAddress()
    if(nodeAddress === ""){
        return
    }
    await fundAddress(nodeAddress)

    await chainlinkToken.transfer(nodeAddress, ethers.utils.parseEther("10000"))
    await chainlinkToken.transfer(config.testAddress, ethers.utils.parseEther("1000"))
    
    const chainlinOracle = await setupChainlinkOracle(knownSigner, chainlinkToken.address, nodeAddress)

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

    const tusdContract = await deployTUSDToken(knownSigner)
    const tusdContractAddress = tusdContract.address
    await tusdContract.transfer(config.testAddress, '500000000')

    const eventEmitterContract = await deployEventEmitter(knownSigner)
    const eventEmitterAddress = eventEmitterContract.address

    
    const authRes = await authenticate()
    const headers = {Cookie: authRes.headers['set-cookie'].join("; ")}

    const bridge = require("./config/bridge.json")
    const bridgeRes = await axios.post("http://localhost:6688/v2/bridge_types", bridge,{headers})
    const bridgeID = bridgeRes.data.data.id
    
    const getAddressJob = require("./config/getbalance.spec.json")
    getAddressJob.initiators[0].params.address = chainlinOracleAddress
    const getAddressJobRes = await axios.post("http://localhost:6688/v2/specs", getAddressJob,{headers})
    const getAddressJobID = getAddressJobRes.data.data.id
    
    const swipswapContract = await deploySwipswapContract(chainlinkTokenAddress, chainlinOracleAddress, ethers.utils.toUtf8Bytes(getAddressJobID), knownSigner)
    const swipswapAddress = swipswapContract.address
    await swipswapContract.initiaze(config.testAddress, tusdContractAddress, 8, 3, eventEmitterAddress)
    await store.chainlinkToken.transfer(swipswapAddress,ethers.utils.parseEther("1000"))

    const paymentJob = require("./config/finalize.spec.json")
    paymentJob.initiators[0].params.address = eventEmitterAddress
    paymentJob.tasks[2].params.address = swipswapAddress

    const paymentJobRes = await axios.post("http://localhost:6688/v2/specs",paymentJob,{headers})
    const paymentJobID = paymentJobRes.data.data.id

    console.log({
        chainlinkTokenAddress,
        chainlinOracleAddress,
        nodeAddress:    store.nodeAddress,
        tusdContractAddress,
        eventEmitterAddress,
        bridgeID,
        paymentJobID,
        swipswapAddress
    })
}

// main(callbackFunction)
module.exports = {
    setupNode: main,
    callbackFunction
}
