const ethers = require("ethers")
const axios = require("axios")
const config = require("./config/config.json")
const { tokenABI, oracleABI } = require("./prebuild/abi")
const { ropstenDetails } = require('../nodeDetails')

const { abi: erc20TokenABI } = require("../artifacts/contracts/ERC20Token.sol/TOEKN.json")
const { abi: eventEmitterABI } = require("../artifacts/contracts/SwipSwapEventEmitter.sol/SwipSwapEventEmitter.json")
const { abi: swipswapABI } = require("../artifacts/contracts/SwipSwapPool.sol/SwipSwapPool.json")
const { abi: swipTokenABI } = require("../artifacts/contracts/SwipToken.sol/SwipToken.json")

const getSigner = async () => {
    const provider = new ethers.providers.AlchemyProvider('ropsten', 'ZiopotbNwrDjZTG1zVV7Tl0qkALAxjD1')
    const wallet = ethers.Wallet.fromMnemonic(config.mnemonic)
    return wallet.connect(provider)
}
const fundAddress = async (signer, address, value) => {
    console.log(`Funding ${address} with ${value} Eth`)
    await signer.sendTransaction({
        value: ethers.utils.parseEther(String(value)),
        to: address
    })
}

const connectChainlinkToken = async (address, abi, signer) => {
    const contract = new ethers.Contract(address, abi, signer)
    return contract.attach(address)
}

const connectFUSDToken = async (address, abi, signer) => {
    const contract = new ethers.Contract(address, abi, signer)
    return contract.attach(address)
}

const connectEventEmitter = async (address, abi, signer) => {
    const contract = new ethers.Contract(address, abi, signer)
    return contract.attach(address)
}

const connectSwipswapContract = async (address, abi, signer) => {
    const contract = new ethers.Contract(address, abi, signer)
    return contract.attach(address)
}

const setupChainlinkOracle = async (address, abi, signer, nodeAddress) => {
    const contract = new ethers.Contract(address, abi, signer)
    const contractInstance = contract.attach(address)
    await contractInstance.setFulfillmentPermission(nodeAddress, true)
    return contractInstance
}

const connectSWIPToken = async (address, abi, signer) => {
    const contract = new ethers.Contract(address, abi, signer)
    return contract.attach(address)
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
    await sleep(10)
    const knownSigner = await getSigner()

    const chainlinkToken = await connectChainlinkToken(ropstenDetails.chainlinkTokenAddress, tokenABI, knownSigner)
    console.log(`Connected to chainlink token contract at ${chainlinkToken.address}`)

    const nodeAddress = await getNodeAddress()
    if(nodeAddress === ""){
        return
    }
    
    // await fundAddress(knownSigner, nodeAddress, 0.001)

    // await chainlinkToken.transfer(nodeAddress, ethers.utils.parseEther("100"))
    // console.log('Transferred LINK to chainlink node successfully')
    
    const chainlinkOracle = await setupChainlinkOracle(ropstenDetails.chainlinkOracleAddress, oracleABI, knownSigner, nodeAddress)
    console.log('Chainlink oracle setup completed')

    _store = {..._store, chainlinkToken, knownSigner, chainlinkOracle, nodeAddress}

    await callbackFunction(_store)
}

const authenticate = async() => {
    let res = await axios.post("http://localhost:6688/sessions", {email:"user@mail.com", password:"password"}, {withCredentials: true})
    return res
}


const callbackFunction = async (store) => {
    const knownSigner = store.knownSigner
    const chainlinkTokenAddress = store.chainlinkToken.address
    const chainlinkOracleAddress = store.chainlinkOracle.address

    const fusdContract = await connectFUSDToken(ropstenDetails.fusdContractAddress, erc20TokenABI, knownSigner)
    console.log(`Connected to FUSD at ${ropstenDetails.fusdContractAddress}`)
    
    const eventEmitterContract = await connectEventEmitter(ropstenDetails.eventEmitterAddress, eventEmitterABI, knownSigner)
    console.log(`Connected to EventEmitter at ${ropstenDetails.eventEmitterAddress}`)
    
    const authRes = await authenticate()
    const headers = {Cookie: authRes.headers['set-cookie'].join("; ")}

    const bridge = require("./config/bridge.json")
    const bridgeRes = await axios.post("http://localhost:6688/v2/bridge_types", bridge,{headers})
    const bridgeID = bridgeRes.data.data.id
    
    const getAddressJob = require("./config/getbalance.spec.json")
    getAddressJob.initiators[0].params.address = chainlinkOracleAddress

    const getAddressJobRes = await axios.post("http://localhost:6688/v2/specs", getAddressJob,{headers})
    
    const swipswapContract = await connectSwipswapContract(ropstenDetails.swipswapAddress, swipswapABI, knownSigner)
    console.log(`Connected to SwipSwapPool at ${swipswapContract.address}`)

    const paymentJob = require("./config/finalize.spec.json")
    paymentJob.initiators[0].params.address = eventEmitterContract.address
    paymentJob.tasks[2].params.address = swipswapContract.address

    const paymentJobRes = await axios.post("http://localhost:6688/v2/specs",paymentJob,{headers})
    const paymentJobID = paymentJobRes.data.data.id

    const swipTokenContract = await connectSWIPToken(ropstenDetails.swipTokenContractAddress, swipTokenABI, knownSigner)
    console.log(`Connected to SWIP token at ${swipTokenContract.address}`)

    console.log({
        chainlinkTokenAddress,
        chainlinkOracleAddress,
        nodeAddress: store.nodeAddress,
        fusdContractAddress: fusdContract.address,
        eventEmitterAddress: eventEmitterContract.address,
        bridgeID,
        paymentJobID,
        swipswapAddress: swipswapContract.address,
        swipTokenContractAddress: swipTokenContract.address
    })
}

main(callbackFunction)
