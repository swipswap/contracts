const ethers = require("ethers")
const axios = require("axios")
const config = require("./config/config.json")
const { tokenABI, oracleABI } = require("../prebuild/abi")
const { ropstenDetails } = require('../nodeDetails')

const ethers = require("ethers")
const axios = require("axios")
const config = require("../../ropsten_node/config/config.json")
const getAddressJob = require("../../ropsten_node/config/getbalance.spec.json")
const bridge = require("../../ropsten_node/config/bridge.json")
const paymentJob = require("../../ropsten_node/config/finalize.spec.json")
const { tokenABI, oracleABI } = require("../../prebuild/abi")

const { abi: erc20TokenABI } = require("../artifacts/contracts/ERC20Token.sol/TOEKN.json")
const { abi: eventEmitterABI } = require("../artifacts/contracts/SwipSwapEventEmitter.sol/SwipSwapEventEmitter.json")
const { abi: swipswapABI } = require("../artifacts/contracts/SwipSwapPool.sol/SwipSwapPool.json")
const { abi: swipTokenABI } = require("../artifacts/contracts/SwipToken.sol/SwipToken.json")

const getSigner = async () => {
    const provider = new ethers.providers.getDefaultProvider('ropsten',{  
        etherscan: '7JTNTAD7VNR5F9CZ68JKCZSWI2ATZG7393',
        infura: '15be5db7406e4da6a3079f577dadb2b5',
        alchemy: 'ZiopotbNwrDjZTG1zVV7Tl0qkALAxjD1'
    })

    const wallet = ethers.Wallet.fromMnemonic(config.mnemonic)
    return wallet.connect(provider)
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

    try {

        const fusdContract = await connectFUSDToken(ropstenDetails.fusdContractAddress, erc20TokenABI, knownSigner)
        console.log(`Connected to FUSD at ${ropstenDetails.fusdContractAddress}`)
        
        const eventEmitterContract = await connectEventEmitter(ropstenDetails.eventEmitterAddress, eventEmitterABI, knownSigner)
        console.log(`Connected to EventEmitter at ${ropstenDetails.eventEmitterAddress}`)
        
        const authRes = await authenticate()
        const headers = {Cookie: authRes.headers['set-cookie'].join("; ")}

        const bridgeRes = await axios.post("http://localhost:6688/v2/bridge_types", bridge,{headers})
        const bridgeID = bridgeRes.data.data.id
        
        getAddressJob.initiators[0].params.address = chainlinkOracleAddress
        
        const swipswapContract = await connectSwipswapContract(ropstenDetails.swipswapAddress, swipswapABI, knownSigner)
        console.log(`Connected to SwipSwapPool at ${swipswapContract.address}`)

        paymentJob.initiators[0].params.address = eventEmitterContract.address
        paymentJob.tasks[2].params.address = swipswapContract.address
    
        await axios.post("http://localhost:6688/v2/specs",paymentJob,{headers})
        // const paymentJobID = paymentJobRes.data.data.id
    
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
    } catch(e) {
        console.log(e)
    }

}

async function connectNode() {
    try {
        await main(callbackFunction)
    } catch (error) {
        console.error('deployment on local network failed', error)
    }
}
  
connectNode()
    .then(() => process.exit(0))
    .catch(error => {
      console.error(error);
      process.exit(1);
    });
