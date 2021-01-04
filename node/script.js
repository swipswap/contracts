const ethers = require("ethers")
const axios = require("axios")
const { tokenABI, oracleABI } = require("../prebuild/abi")
const { tokenBytecode, oracleBytecode } = require("../prebuild/bytecodes")
const deploymentConfig = require('../config/deploy.json')

const {abi: erc20TokenABI, bytecode: erc20TokenBytecode} = require("../artifacts/contracts/ERC20Token.sol/TOEKN.json")
const {abi: eventEmitterABI, bytecode: eventEmitterBytecode} = require("../artifacts/contracts/SwipSwapEventEmitter.sol/SwipSwapEventEmitter.json")
const {abi: swipswapABI, bytecode: swipswapBytecode} = require("../artifacts/contracts/SwipSwapPool.sol/SwipSwapPool.json")
const {abi: swipTokenABI, bytecode: swipTokenBytecode} = require("../artifacts/contracts/SwipToken.sol/SwipToken.json")
const {abi: swipxABI, bytecode: swipxBytecode} = require("../artifacts/contracts/Swipx.sol/Swipx.json")

const network = process.env.network
const isLocalNetwork = network === 'local'
if(!network){
    console.error("Newtork is not set")
    process.exit(1)
}
console.info(`Network set to ${network}`)
const config = deploymentConfig[network]
const deployments = config.deployments


const connectAndGetProvider = async () => {
    if(network){
        return new ethers.providers.JsonRpcProvider(config.providerUrl)
    }
    const providerNetowrk = ethers.providers.getNetwork(config.network)
    return new ethers.providers.getDefaultProvider(providerNetowrk, {
        etherscan: config.etherscan,
        infura: {
            projectId: config.infuraProjectId,
            projectSecret: config.infuraProjectSecret
        },
        alchemy: config.alchemy
    })
}

const getDeployer = async (provider) => {
	const deployer = ethers.Wallet.fromMnemonic(config.mnemonic).connect(provider)
	return deployer
}

const getAddressFunder = (provider, startingIndex=2) => {
    if(!isLocalNetwork)return
	let currentIndex = startingIndex
	return async (address, etherValue=80) => {
        if(!isLocalNetwork)return
		try {
			console.log(`Funding ========= ${etherValue} ETH ===========>>> ${address}`)
			await provider.getSigner(currentIndex).sendTransaction({
					value: ethers.utils.parseEther(String(etherValue)),
					to: address
			})
			currentIndex +=1
		} catch (error) {
			console.log(`Error funding ${address} with ETH`, error)
		}
	}
}

const deployChainlinkToken = async (signer) => {
    const factory = new ethers.ContractFactory(tokenABI, tokenBytecode, signer)
    const contract = await factory.deploy()
    await contract.deployTransaction.wait()
    return contract
}

const deployFUSDToken = async (signer) => {
    if(network === 'mainnet')return
	const factory = new ethers.ContractFactory(erc20TokenABI, erc20TokenBytecode, signer)
	const contract = await factory.deploy("Fake USD","FUSD", 1_000_000_000)
	await contract.deployTransaction.wait()
	return contract
}

const deployEventEmitter = async (signer) => { // this should be removed when chainlink issue is fixed
	const factory = new ethers.ContractFactory(eventEmitterABI, eventEmitterBytecode, signer)
	const contract = await factory.deploy()
	await contract.deployTransaction.wait()
	return contract
}

const deploySwipswapContract = async (chainlinkTokenAddress, oracleAddress, jobID, signer) => {
    const noOfBlocks = network === "local" ? 3 : 60
	const factory = new ethers.ContractFactory(swipswapABI, swipswapBytecode, signer)
	const contract = await factory.deploy(chainlinkTokenAddress, oracleAddress, jobID, noOfBlocks)
	await contract.deployTransaction.wait()
	return contract
}

const setupChainlinkOracle = async (signer, linkToken, nodeAddress) => {
	const factory = new ethers.ContractFactory(oracleABI, oracleBytecode, signer)
	const contract = await factory.deploy(linkToken)
	await contract.deployTransaction.wait()
	await contract.setFulfillmentPermission(nodeAddress, true)
	return contract
}

const deploySWIPToken = async (signer) => {
	const factory = new ethers.ContractFactory(swipTokenABI, swipTokenBytecode, signer)
	const contract = await factory.deploy()
	await contract.deployTransaction.wait()
	return contract
}

const deploySWIPX = async (signer) => {
	const factory = new ethers.ContractFactory(swipxABI, swipxBytecode, signer)
	const contract = await factory.deploy()
	await contract.deployTransaction.wait()
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

const authenticate = async() => {
    let res = await axios.post('http://localhost:6688/sessions', { email: 'user@mail.com', password:'password' }, { withCredentials: true })
    return res
}

const findPubkeyBridge = (data) => {
    for(const item of data){
        if(item.id === 'getpubkeybalance'){
            return item
        }
    }
    return null
}

const findPubkeyBalJob = (data) => {
    for(const item of data){
        if(item.attributes.tasks[0].type === 'getpubkeybalance'){
            return item
        }
    }
    return null
}
const findEmmiterJob = (data) => {
    for(const item of data){
        if(item.attributes.initiators[0].type === 'ethlog'){
            return item
        }
    }
    return null
}

module.exports = {
    connectAndGetProvider,
    getDeployer,
    getAddressFunder,
    deployChainlinkToken,
    deployFUSDToken,
    deployEventEmitter,
    deploySwipswapContract,
    setupChainlinkOracle,
    deploySWIPToken,
    deploySWIPX,
    sleep,
    getNodeAddress,
    authenticate,
    config,
    deployments,
    findPubkeyBridge,
    findPubkeyBalJob,
    findEmmiterJob,
}
