const ethers = require("ethers")
const axios = require("axios")
const config = require("../../local_node/config/config.json")
const { tokenABI, oracleABI } = require("../../prebuild/abi")
const { tokenBytecode, oracleBytecode } = require("../../prebuild/bytecodes")
const bridge = require("../../config/bridge.json")
const getAddressJob = require("../../config/getbalance.spec.json")
const paymentJob = require("../../config/finalize.spec.json")
const { saveToFile } = require('./deploymentsHandler')
const { localDeployments } = require('./deployments.js')

const {abi: erc20TokenABI, bytecode: erc20TokenBytecode} = require("../../artifacts/contracts/ERC20Token.sol/TOEKN.json")
const {abi: eventEmitterABI, bytecode: eventEmitterBytecode} = require("../../artifacts/contracts/SwipSwapEventEmitter.sol/SwipSwapEventEmitter.json")
const {abi: swipswapABI, bytecode: swipswapBytecode} = require("../../artifacts/contracts/SwipSwapPool.sol/SwipSwapPool.json")
const {abi: swipTokenABI, bytecode: swipTokenBytecode} = require("../../artifacts/contracts/SwipToken.sol/SwipToken.json")

const connectAndGetProvider = async () => {
    const provider = new ethers.providers.JsonRpcProvider("http://0.0.0.0:6690")
    return provider
}

const getDeployer = async (provider) => {
    const deployer = ethers.Wallet.fromMnemonic(config.mnemonic).connect(provider)
    return deployer
}

const getAddressFunder = (provider, startingIndex=2) => {
    let currentIndex = startingIndex
    return async (address, etherValue=80) => {
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
	try {
		await sleep(5)

		_store.provider = await connectAndGetProvider()
		const fundAddress = getAddressFunder(_store.provider)
		_store.deployer = await getDeployer(_store.provider)
		const signerBalance = await _store.deployer.getBalance()
		if(Number(signerBalance) === 0) {
			await fundAddress(await _store.deployer.getAddress())
			console.log('Funded deploying account with ETH')
			
		}
		const testAddressBalance = await _store.provider.getBalance(config.testAddress)
		if(Number(testAddressBalance) === 0) {
			await fundAddress(config.testAddress)
			console.log('Funded test address with ETH')
		}
				
		_store.nodeAddress = await getNodeAddress()
		if(_store.nodeAddress === ""){
			return
		}
		const nodeAddressBalance = await _store.provider.getBalance(_store.nodeAddress)
		if(Number(nodeAddressBalance) === 0) {
			await fundAddress(_store.nodeAddress)
			console.log('Funded chainlink node account with ETH')
		}

		} catch(e) {
			throw new Error(e)
		}
				
    await callbackFunction(_store)
}

const authenticate = async() => {
    let res = await axios.post("http://localhost:6688/sessions", {email:"user@mail.com", password:"password"}, {withCredentials: true})
    return res
}


const callbackFunction = async (store) => {
    const deploymentDetails = { deployer: store.deployer, nodeAddress: store.nodeAddress }
    let authRes
    let bridgeRes
    let getAddressJobRes
    let jobsExists
	try {
      authRes = await authenticate()
    } catch(e){
        throw new Error(e)
    }
    const headers = {Cookie: authRes.headers['set-cookie'].join("; ")}
    try {
        bridgeRes = await axios.get("http://localhost:6688/v2/bridge_types", { headers })
        if(bridgeRes.data.data.length > 0) {
            deploymentDetails.bridgeID = bridgeRes.data.data[0].id
        } else {
            bridgeRes = await axios.post("http://localhost:6688/v2/bridge_types", bridge, { headers })
            deploymentDetails.bridgeID = bridgeRes.data.data.id
        }
    } catch(e){
        console.error(e.data)
    }
    
	try {
        jobsExists = await axios.get("http://localhost:6688/v2/specs", { headers })
    } catch(e) {
        console.error(e)
    }
    const getpub = []
    const copy = []
    if(jobsExists.data.data.length > 0) {
			jobsExists.data.data.map(d =>{
				d.attributes.tasks.find(g => {
					if(g.type === 'getpubkeybalance') {
						getpub.push({ chainlinkOracleAddress: d.attributes.initiators[0].params.address, id: d.id })
						return true
					}
					return false
				})
				d.attributes.tasks.find(c => {
					if(c.type === 'copy'){
						copy.push({ eventEmitterAddress: d.attributes.initiators[0].params.address, swipSwapAddress: d.attributes.tasks[2].params.address, id: d.id })
						return true
					}
					return false
				})
			})
    }
		
    if (getpub.length > 0) {
			deploymentDetails.getAddressJobID = getpub[0].id
			deploymentDetails.chainlinkOracleAddress = getpub[0].chainlinkOracleAddress
    } else {
			try {
				// If chainlinkToken has been deployed or deploy new one
				if(!localDeployments.chainlinkTokenAddress) {
					const chainlinkToken = await deployChainlinkToken(deploymentDetails.deployer)
					console.log(`Deployed chainlinkToken at ${chainlinkToken.address}`)
					await chainlinkToken.transfer(deploymentDetails.nodeAddress, ethers.utils.parseEther("10000"))
					await chainlinkToken.transfer(config.testAddress, ethers.utils.parseEther("1000"))
					deploymentDetails.chainlinkTokenAddress = chainlinkToken.address
				} else {
					console.log(`Skipping "deploy chainlinkToken", found at ${localDeployments.chainlinkTokenAddress}`)
					deploymentDetails.chainlinkTokenAddress = localDeployments.chainlinkTokenAddress
				}
				if(!localDeployments.chainlinkOracleAddress) {
					const chainlinkOracle = await setupChainlinkOracle(deploymentDetails.deployer, deploymentDetails.chainlinkTokenAddress, store.nodeAddress)
					deploymentDetails.chainlinkOracleAddress = chainlinkOracle.address
					console.log(`Oracle deployed successfully at ${chainlinkOracle.address}`)
				} else {
					console.log(`Skipping "deploy oracle", found at ${localDeployments.chainlinkOracleAddress}`)
					deploymentDetails.chainlinkTokenAddress = localDeployments.chainlinkOracleAddress
				}
				getAddressJob.initiators[0].params.address = deploymentDetails.chainlinkOracleAddress
				getAddressJobRes = await axios.post("http://localhost:6688/v2/specs", getAddressJob, { headers })
				deploymentDetails.getAddressJobID = getAddressJobRes.data.data.id
			} catch(e){
				throw new Error(e)
			}
		}
        
    // Handle jobs creation or population logic
    if (copy.length > 0) {
			deploymentDetails.eventEmitterAddress = copy[0].eventEmitterAddress
			deploymentDetails.swipSwapAddress = copy[0].swipSwapAddress
    } else {
			try {
				let swipswapContract
				if (!localDeployments.chainlinkTokenAddress) {
					const chainlinkToken = await deployChainlinkToken(deploymentDetails.deployer)
					console.log(`Deployed chainlinkToken at ${chainlinkToken.address}`)
					await chainlinkToken.transfer(deploymentDetails.nodeAddress, ethers.utils.parseEther("10000"))
					await chainlinkToken.transfer(config.testAddress, ethers.utils.parseEther("1000"))
					deploymentDetails.chainlinkTokenAddress = chainlinkToken.address
				}
				
				if(!localDeployments.swipSwapAddress) {
					swipswapContract = await deploySwipswapContract(deploymentDetails.chainlinkTokenAddress, deploymentDetails.chainlinkOracleAddress, ethers.utils.toUtf8Bytes(deploymentDetails.getAddressJobID), deploymentDetails.deployer)
					console.log(`Deployed swipswap pool to ${swipswapContract.address}`)
					deploymentDetails.swipSwapAddress = swipswapContract.address
				} else {
					console.log(`Skipping "deploy swipswap", found at ${localDeployments.swipSwapAddress}`)
					deploymentDetails.chainlinkTokenAddress = localDeployments.chainlinkOracleAddress
					// create an instance of the existing contract if it exists
					swipswapContract = new ethers.Contract(localDeployments.swipSwapAddress, swipswapABI, deploymentDetails.deployer)
					// swipswapContract.attach(localDeployments.swipSwapAddress)
				}

				if(!localDeployments.eventEmitterAddress) {
					const eventEmitterContract = await deployEventEmitter(deploymentDetails.deployer)
					deploymentDetails.eventEmitterAddress = eventEmitterContract.address
					console.log(`Deployed eventEmitter to ${eventEmitterContract.address}`)
				} else {
					console.log(`Skipping "deploy oracle", found at ${localDeployments.chainlinkOracleAddress}`)
					deploymentDetails.chainlinkTokenAddress = localDeployments.chainlinkOracleAddress
				}
				
				if (!localDeployments.fusdContractAddress) {
					const fusdContract = await deployFUSDToken(deploymentDetails.deployer)
					deploymentDetails.fusdContractAddress = fusdContract.address
					await fusdContract.transfer(config.testAddress, '500000000')
					console.log(`FUSD deployed at ${fusdContract.address} and funded`)
				} else {
					console.log(`Skipping "deploy FUSD token", found at ${localDeployments.fusdContractAddress}`)
					deploymentDetails.chainlinkTokenAddress = localDeployments.fusdContractAddress
				}
				
				const initializeSwipswap = await swipswapContract.initialize(config.testAddress, deploymentDetails.fusdContractAddress, 8, 3, deploymentDetails.eventEmitterAddress)
				await initializeSwipswap.wait()
				paymentJob.initiators[0].params.address = deploymentDetails.eventEmitterAddress
				paymentJob.tasks[2].params.address = deploymentDetails.swipSwapAddress
				const paymentJobRes = await axios.post("http://localhost:6688/v2/specs", paymentJob, { headers })
				deploymentDetails.paymentJobID = paymentJobRes.data.data.id
			} catch(e){
				throw new Error(e)
			}
		}

		try {
			const swipTokenContract = await deploySWIPToken(deploymentDetails.deployer)
			console.log(`Deployed SWIP token at ${swipTokenContract.address}`)
			deploymentDetails.swipTokenContractAddress = swipTokenContract.address
			await swipTokenContract.transfer(config.testAddress, 1_000_000_000)
		} catch(e) {
			throw new Error(e)
		}
		const result = ({...deploymentDetails, deployer: await deploymentDetails.deployer.getAddress()})
		console.log(result)
		// await saveToFile(result)
}

async function deployLocalNode() {
  try {
      await main(callbackFunction)
  } catch (error) {
      console.error('deployment on local network failed', error)
  }
}

deployLocalNode()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
	})
	