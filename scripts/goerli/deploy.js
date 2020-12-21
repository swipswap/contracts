const ethers = require("ethers")
const axios = require("axios")
const config = require("../../goerli_node/config/config.json")
const { tokenABI, oracleABI } = require("../../prebuild/abi")
const { tokenBytecode, oracleBytecode } = require("../../prebuild/bytecodes")
const bridge = require("../../config/bridge.json")
const getAddressJob = require("../../config/getbalance.spec.json")
const paymentJob = require("../../config/finalize.spec.json")
const { saveToFile } = require('./deploymentsHandler')
const { goerliDeployments } = require('./deployments.js')

const {abi: erc20TokenABI, bytecode: erc20TokenBytecode} = require("../../artifacts/contracts/ERC20Token.sol/TOEKN.json")
const {abi: eventEmitterABI, bytecode: eventEmitterBytecode} = require("../../artifacts/contracts/SwipSwapEventEmitter.sol/SwipSwapEventEmitter.json")
const {abi: swipswapABI, bytecode: swipswapBytecode} = require("../../artifacts/contracts/SwipSwapPool.sol/SwipSwapPool.json")
const {abi: swipTokenABI, bytecode: swipTokenBytecode} = require("../../artifacts/contracts/SwipToken.sol/SwipToken.json")

const network = ethers.providers.getNetwork(config.network)

const connectAndGetProvider = async () => {
    return new ethers.providers.getDefaultProvider(network, {
        etherscan: '7JTNTAD7VNR5F9CZ68JKCZSWI2ATZG7393',
        infura: {
            projectId: '15be5db7406e4da6a3079f577dadb2b5',
            projectSecret: '6038650c6017459d8ec21a95b4c14afe'
        },
        alchemy: '9GJ40fZ1PGwqID6jUHOyzdyEsPLqE7Kn'
    })
}

const getDeployer = async (provider) => {
	const deployer = ethers.Wallet.fromMnemonic(config.mnemonic).connect(provider)
	return deployer
}

const deployChainlinkToken = async (signer) => {
    const factory = new ethers.ContractFactory(tokenABI, tokenBytecode, signer)
    const contract = await factory.deploy()
    await contract.deployTransaction.wait()
    return contract
}

const deployFUSDToken = async (signer) => {
	const factory = new ethers.ContractFactory(erc20TokenABI, erc20TokenBytecode, signer)
	const contract = await factory.deploy("Fake USD","FUSD", 1_000_000_000)
	await contract.deployTransaction.wait()
	return contract
}

const deployEventEmitter = async (signer) => {
	const factory = new ethers.ContractFactory(eventEmitterABI, eventEmitterBytecode, signer)
	const contract = await factory.deploy()
	await contract.deployTransaction.wait()
	return contract
}

const deploySwipswapContract = async (chainlinkTokenAddress, oracleAddress, jobID, signer) => {
	const factory = new ethers.ContractFactory(swipswapABI, swipswapBytecode, signer)
	const contract = await factory.deploy(chainlinkTokenAddress, oracleAddress, jobID)
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
	const contract = await factory.deploy(10_000, 1_000_000_000)
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

const main = async (callbackFunction=()=>{}) => {
	let _store = {}
	try {
		await sleep(5)

		_store.provider = await connectAndGetProvider()
		_store.deployer = await getDeployer(_store.provider)
		const signerBalance = await _store.deployer.getBalance()
		console.log(`Deploying account has a balance of ${Number(signerBalance)} ETH (Goerli)`)

		if(await _store.deployer.getAddress() !== config.testAddress) {
			const testAddressBalance = await _store.provider.getBalance(config.testAddress)
			console.log(`Deploying account has a balance of ${Number(testAddressBalance)} ETH (Goerli)`)
		}       
		
		_store.nodeAddress = await getNodeAddress()
		if(_store.nodeAddress === ""){
			return
		}

		if(_store.nodeAddress !== goerliDeployments.nodeAddress && goerliDeployments.nodeAddress) {
			console.info('Node Address is different from the one in the deployments!!!')
    }
        
		const nodeAddressBalance = await _store.provider.getBalance(_store.nodeAddress)
		console.log(`Node address has a balance of ${Number(nodeAddressBalance)} ETH (Goerli)`)

		} catch(e) {
			throw new Error(e)
		}
				
    await callbackFunction(_store)
}

const authenticate = async() => {
    let res = await axios.post('http://localhost:6688/sessions', { email: 'user@mail.com', password:'password' }, { withCredentials: true })
    return res
}


const callbackFunction = async (store) => {
	const deploymentDetails = { deployer: store.deployer, nodeAddress: store.nodeAddress }
	const contracts = {}
	let authRes
	let bridgeRes
	let jobsExist
	try {
    authRes = await authenticate()
  } catch(e){
    throw new Error(e)
  }
		const headers = { Cookie: authRes.headers['set-cookie'].join("; ") }
		
    try {
			bridgeRes = await axios.get('http://localhost:6688/v2/bridge_types', { headers })
			if(bridgeRes.data.data.length > 0) {
					deploymentDetails.bridgeID = bridgeRes.data.data[0].id
			} else {
				bridgeRes = await axios.post('http://localhost:6688/v2/bridge_types', bridge, { headers })
				deploymentDetails.bridgeID = bridgeRes.data.data.id
			}
    } catch(e){
      console.error(e.data)
    }
    
		try {
      jobsExist = await axios.get('http://localhost:6688/v2/specs', { headers })
    } catch(e) {
      console.error(e)
		}
		
    const getAddrJob = []
		const payJob = []
    if(jobsExist.data.data.length > 0) {
			jobsExist.data.data.map(d =>{
				d.attributes.tasks.find(getAddr => {
					if(getAddr.type === 'getpubkeybalance') {
						getAddrJob.push({ chainlinkOracleAddress: d.attributes.initiators[0].params.address, id: d.id })
						return true
					}
					return false
				})
				d.attributes.tasks.find(payment => {
					if(payment.type === 'copy'){
						payJob.push({ eventEmitterAddress: d.attributes.initiators[0].params.address, swipSwapAddress: d.attributes.tasks[2].params.address, id: d.id })
						return true
					}
					return false
				})
			})
		}

		if(!goerliDeployments.chainlinkTokenAddress) {
			const chainlinkToken = await deployChainlinkToken(deploymentDetails.deployer)
			deploymentDetails.chainlinkTokenAddress = chainlinkToken.address
			contracts.chainlinkToken = chainlinkToken
			console.log(`>>> Deployed chainlinkToken at ${chainlinkToken.address}`)
		} else {
			const chainlinkToken = new ethers.Contract(goerliDeployments.chainlinkTokenAddress, tokenABI, deploymentDetails.deployer)
			contracts.chainlinkToken = chainlinkToken
			console.log(`Skipping "deploy chainlinkToken", found at ${goerliDeployments.chainlinkTokenAddress}`)
			deploymentDetails.chainlinkTokenAddress = goerliDeployments.chainlinkTokenAddress
		}

		if(!goerliDeployments.chainlinkOracleAddress) {
			const chainlinkOracle = await setupChainlinkOracle(deploymentDetails.deployer, deploymentDetails.chainlinkTokenAddress, store.nodeAddress)
			deploymentDetails.chainlinkOracleAddress = chainlinkOracle.address
			console.log(`>>> Deployed oracle successfully at ${chainlinkOracle.address}`)
		} else {
			console.log(`Skipping "deploy oracle", found at ${goerliDeployments.chainlinkOracleAddress}`)
			deploymentDetails.chainlinkOracleAddress = goerliDeployments.chainlinkOracleAddress
		}

		if (!goerliDeployments.FUSDTokenAddress) {
			const FUSDToken = await deployFUSDToken(deploymentDetails.deployer)
			deploymentDetails.FUSDTokenAddress = FUSDToken.address
			contracts.FUSDToken = FUSDToken
			console.log(`>>> Deployed FUSDToken at ${deploymentDetails.FUSDTokenAddress}`)
		} else {
			const FUSDToken = new ethers.Contract(goerliDeployments.FUSDTokenAddress, erc20TokenABI, deploymentDetails.deployer)
			contracts.FUSDToken = FUSDToken
			console.log(`Skipping "deploy FUSD token", found at ${goerliDeployments.FUSDTokenAddress}`)
			deploymentDetails.FUSDTokenAddress = goerliDeployments.FUSDTokenAddress
		}

		if(!goerliDeployments.eventEmitterAddress) {
			const eventEmitterContract = await deployEventEmitter(deploymentDetails.deployer)
			deploymentDetails.eventEmitterAddress = eventEmitterContract.address
			console.log(`>>> Deployed eventEmitter to ${deploymentDetails.eventEmitterAddress}`)
		} else {
			console.log(`Skipping "deploy eventEmitter", found at ${goerliDeployments.eventEmitterAddress}`)
			deploymentDetails.eventEmitterAddress = goerliDeployments.eventEmitterAddress
		}

		if (getAddrJob.length > 0) {
			deploymentDetails.getAddressJobID = getAddrJob[0].id
			deploymentDetails.chainlinkOracleAddress = getAddrJob[0].chainlinkOracleAddress
			console.log(`Skipping "create getAddressJob" found: ${goerliDeployments.getAddressJobID}`)
		} else {
			getAddressJob.initiators[0].params.address = deploymentDetails.chainlinkOracleAddress
			const getAddressJobRes = await axios.post('http://localhost:6688/v2/specs', getAddressJob, { headers })
			deploymentDetails.getAddressJobID = getAddressJobRes.data.data.id
			console.log(`Added new getAddr jobID: ${deploymentDetails.getAddressJobID}`)
		}

		if(!goerliDeployments.swipSwapAddress) {
			const swipswapContract = await deploySwipswapContract(deploymentDetails.chainlinkTokenAddress, deploymentDetails.chainlinkOracleAddress, ethers.utils.toUtf8Bytes(deploymentDetails.getAddressJobID), deploymentDetails.deployer)
			console.log(`>>> Deployed swipswap pool to ${swipswapContract.address}`)
			await swipswapContract.initialize(config.testAddress, deploymentDetails.FUSDTokenAddress, 8, 3, deploymentDetails.eventEmitterAddress)
			console.info('Initialized swipswap contract successfully')
			deploymentDetails.swipSwapAddress = swipswapContract.address

			contracts.swipswapContract = swipswapContract
		} else {
			console.log(`Skipping "deploy swipswap", found at ${goerliDeployments.swipSwapAddress}`)
			deploymentDetails.swipSwapAddress = goerliDeployments.swipSwapAddress
		}

		if (payJob.length > 0) {
			deploymentDetails.eventEmitterAddress = payJob[0].eventEmitterAddress
			deploymentDetails.swipSwapAddress = payJob[0].swipSwapAddress
    } else {
			paymentJob.initiators[0].params.address = deploymentDetails.eventEmitterAddress
			paymentJob.tasks[2].params.address = deploymentDetails.swipSwapAddress
			const paymentJobRes = await axios.post('http://localhost:6688/v2/specs', paymentJob, { headers })
			deploymentDetails.paymentJobID = paymentJobRes.data.data.id
			console.log(`Created payment jobID: ${deploymentDetails.paymentJobID}`)
		}

		if (!goerliDeployments.SWIPTokenAddress) {
			const SWIPToken = await deploySWIPToken(deploymentDetails.deployer)
			deploymentDetails.SWIPTokenAddress = SWIPToken.address
			contracts.SWIPToken = SWIPToken
			console.log(`>>> Deployed SWIP Token at ${deploymentDetails.SWIPTokenAddress}`)
		} else {
			const SWIPToken = new ethers.Contract(goerliDeployments.SWIPTokenAddress, erc20TokenABI, deploymentDetails.deployer)
			contracts.SWIPToken = SWIPToken
			console.log(`Skipping "deploy SWIP token", found at ${goerliDeployments.SWIPTokenAddress}`)
			deploymentDetails.SWIPTokenAddress = goerliDeployments.SWIPTokenAddress
		}


		// Transfer tokens logic
		const nodeLinkBalance = await contracts.chainlinkToken.balanceOf(deploymentDetails.nodeAddress)
		const testAddrLinkBalance = await contracts.chainlinkToken.balanceOf(config.testAddress)
		const testAddrFUSDBalance = await contracts.FUSDToken.balanceOf(config.testAddress)
		const testAddrSWIPBalance = await contracts.SWIPToken.balanceOf(config.testAddress)
		const swipswapLinkBalance = await contracts.chainlinkToken.balanceOf(deploymentDetails.swipSwapAddress)

		if(deploymentDetails.nodeAddress !== goerliDeployments.nodeAddress || nodeLinkBalance === 0) {
			const tx = await contracts.chainlinkToken.transfer(deploymentDetails.nodeAddress, ethers.utils.parseEther("10000"))
			await tx.wait()
			console.log(`Funded node address: ${deploymentDetails.nodeAddress} with $LINK`)
		}

		if(deploymentDetails.nodeAddress !== goerliDeployments.nodeAddress || testAddrLinkBalance === 0) {
			const tx = await contracts.chainlinkToken.transfer(config.testAddress, ethers.utils.parseEther("1000"))
			await tx.wait()
			console.log(`Funded test address: ${config.testAddress} with $LINK`)
		}

		if(deploymentDetails.FUSDTokenAddress !== goerliDeployments.FUSDTokenAddress || testAddrFUSDBalance === 0) {
			const tx = await contracts.chainlinkToken.transfer(config.testAddress, ethers.utils.parseEther("1000"))
			await tx.wait()
			console.log(`Funded test address: ${deploymentDetails.FUSDTokenAddress} with $LINK`)
		}

		if(deploymentDetails.swipSwapAddress !== goerliDeployments.swipSwapAddress || swipswapLinkBalance === 0) {
			const tx = await contracts.chainlinkToken.transfer(deploymentDetails.swipSwapAddress, ethers.utils.parseEther("1000"))
			await tx.wait()
			console.log(`Funded swipswap contract address: ${deploymentDetails.swipSwapAddress} with $LINK`)
		}

		if(goerliDeployments.swipTokenAddress !== deploymentDetails.swipTokenAddress || testAddrSWIPBalance === 0) {
			const tx = await contracts.SWIPToken.transfer(config.testAddress, 1_000_000_000)
			await tx.wait()
			console.log(`Transfered SWIP Tokens to test address`)
		}
		
		const result = ({...deploymentDetails, deployer: await deploymentDetails.deployer.getAddress()})
		console.log(result)
		// await saveToFile(result)
}


async function deployGoerliNode() {
  try {
      await main(callbackFunction)
  } catch (error) {
      console.error('deployment on local network failed', error)
  }
}

deployGoerliNode()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
	})
	