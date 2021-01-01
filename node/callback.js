const axios = require("axios")
const ethers = require("ethers")
const {
    deployChainlinkToken,
    deployFUSDToken,
    deployEventEmitter,
    deploySwipswapContract,
    setupChainlinkOracle,
    deploySWIPToken,
    authenticate,
    config,
    deployments,
    findPubkeyBridge,
    findPubkeyBalJob,
    findEmmiterJob,
} = require("./script")

const { tokenABI } = require("../prebuild/abi")
const {abi: erc20TokenABI} = require("../artifacts/contracts/ERC20Token.sol/TOEKN.json")

const bridge = require("../config/bridge.json")
const getAddressJob = require("../config/getbalance.spec.json")
const paymentJob = require("../config/finalize.spec.json")

 const callbackFunction = async (store) => {
    const deploymentDetails = { deployer: store.deployer, nodeAddress: store.nodeAddress }
    console.log("callback function")
	const contracts = {}
	let bridgeRes
	let jobsExist
    const authRes = await authenticate()
    const headers = { Cookie: authRes.headers['set-cookie'].join("; ") }
			
    bridgeRes = await axios.get('http://localhost:6688/v2/bridge_types', { headers })
    const pubKeyBridge = findPubkeyBridge(bridgeRes.data.data)
    if (!!pubKeyBridge) {
        deploymentDetails.bridgeID = pubKeyBridge.id
    } else {
        bridgeRes = await axios.post('http://localhost:6688/v2/bridge_types', bridge, { headers })
        deploymentDetails.bridgeID = bridgeRes.data.data.id
    }

		
    jobsExist = await axios.get('http://localhost:6688/v2/specs', { headers })
    const pubKeyBalJob = findPubkeyBalJob(jobsExist.data.data)
    const payJob = findEmmiterJob(jobsExist.data.data)

    if(!deployments.chainlinkTokenAddress) {
        const chainlinkToken = await deployChainlinkToken(deploymentDetails.deployer)
        deploymentDetails.chainlinkTokenAddress = chainlinkToken.address
        contracts.chainlinkToken = chainlinkToken
        console.log(`>>> Deployed chainlinkToken at ${chainlinkToken.address}`)
    } else {
        const chainlinkToken = new ethers.Contract(deployments.chainlinkTokenAddress, tokenABI, deploymentDetails.deployer)
        contracts.chainlinkToken = chainlinkToken
        console.log(`Skipping "deploy chainlinkToken", found at ${deployments.chainlinkTokenAddress}`)
        deploymentDetails.chainlinkTokenAddress = deployments.chainlinkTokenAddress
    }

    if(!deployments.chainlinkOracleAddress) {
        const chainlinkOracle = await setupChainlinkOracle(deploymentDetails.deployer, deploymentDetails.chainlinkTokenAddress, store.nodeAddress)
        deploymentDetails.chainlinkOracleAddress = chainlinkOracle.address
        console.log(`>>> Deployed oracle successfully at ${chainlinkOracle.address}`)
    } else {
        console.log(`Skipping "deploy oracle", found at ${deployments.chainlinkOracleAddress}`)
        deploymentDetails.chainlinkOracleAddress = deployments.chainlinkOracleAddress
    }

    if (!deployments.FUSDTokenAddress) {
        const FUSDToken = await deployFUSDToken(deploymentDetails.deployer)
        deploymentDetails.FUSDTokenAddress = FUSDToken.address
        contracts.FUSDToken = FUSDToken
        console.log(`>>> Deployed FUSDToken at ${deploymentDetails.FUSDTokenAddress}`)
    } else {
        const FUSDToken = new ethers.Contract(deployments.FUSDTokenAddress, erc20TokenABI, deploymentDetails.deployer)
        contracts.FUSDToken = FUSDToken
        console.log(`Skipping "deploy FUSD token", found at ${deployments.FUSDTokenAddress}`)
        deploymentDetails.FUSDTokenAddress = deployments.FUSDTokenAddress
    }

    if(!deployments.eventEmitterAddress) {
        const eventEmitterContract = await deployEventEmitter(deploymentDetails.deployer)
        deploymentDetails.eventEmitterAddress = eventEmitterContract.address
        console.log(`>>> Deployed eventEmitter to ${deploymentDetails.eventEmitterAddress}`)
    } else {
        console.log(`Skipping "deploy eventEmitter", found at ${deployments.eventEmitterAddress}`)
        deploymentDetails.eventEmitterAddress = deployments.eventEmitterAddress
    }

    if (pubKeyBalJob && deploymentDetails.chainlinkOracleAddress.toLowerCase() === pubKeyBalJob.attributes.initiators[0].params.address.toLowerCase()) {
        deploymentDetails.getAddressJobID = pubKeyBalJob.id
        console.log(`Skipping "create getAddressJob" found: ${deployments.getAddressJobID}`)
    } else {
        getAddressJob.initiators[0].params.address = deploymentDetails.chainlinkOracleAddress
        const getAddressJobRes = await axios.post('http://localhost:6688/v2/specs', getAddressJob, { headers })
        deploymentDetails.getAddressJobID = getAddressJobRes.data.data.id
        console.log(`Added new getAddr jobID: ${deploymentDetails.getAddressJobID}`)
    }

    if(!deployments.swipSwapAddress) {
        const swipswapContract = await deploySwipswapContract(deploymentDetails.chainlinkTokenAddress, deploymentDetails.chainlinkOracleAddress, ethers.utils.toUtf8Bytes(deploymentDetails.getAddressJobID), deploymentDetails.deployer)
        console.log(`>>> Deployed swipswap pool to ${swipswapContract.address}`)
        await swipswapContract.initialize(config.testAddress, deploymentDetails.FUSDTokenAddress, 8, 3, deploymentDetails.eventEmitterAddress)
        console.info('Initialized swipswap contract successfully')
        deploymentDetails.swipSwapAddress = swipswapContract.address
        
        console.log('Transferred $FLINK to swipswap contract')
        contracts.swipswapContract = swipswapContract
    } else {
        console.log(`Skipping "deploy swipswap", found at ${deployments.swipSwapAddress}`)
        deploymentDetails.swipSwapAddress = deployments.swipSwapAddress
    }

    if (payJob
        && payJob.attributes.initiators[0].params.address.toLowerCase() ===  deploymentDetails.eventEmitterAddress.toLowerCase()
        && payJob.attributes.tasks[2].params.address.toLowerCase() === deploymentDetails.swipSwapAddress.toLowerCase()) {
        deploymentDetails.paymentJobID = payJob.id
    } else {
        paymentJob.initiators[0].params.address = deploymentDetails.eventEmitterAddress
        paymentJob.tasks[2].params.address = deploymentDetails.swipSwapAddress
        const paymentJobRes = await axios.post('http://localhost:6688/v2/specs', paymentJob, { headers })
        deploymentDetails.paymentJobID = paymentJobRes.data.data.id
        console.log(`Created payment jobID: ${deploymentDetails.paymentJobID}`)
    }

    if (!deployments.SWIPTokenAddress) {
        const SWIPToken = await deploySWIPToken(deploymentDetails.deployer)
        deploymentDetails.SWIPTokenAddress = SWIPToken.address
        contracts.SWIPToken = SWIPToken
        console.log(`>>> Deployed SWIP Token at ${deploymentDetails.SWIPTokenAddress}`)
    } else {
        const SWIPToken = new ethers.Contract(deployments.SWIPTokenAddress, erc20TokenABI, deploymentDetails.deployer)
        contracts.SWIPToken = SWIPToken
        console.log(`Skipping "deploy SWIP token", found at ${deployments.SWIPTokenAddress}`)
        deploymentDetails.SWIPTokenAddress = deployments.SWIPTokenAddress
    }


    // Transfer tokens logic
    const nodeLinkBalance = await contracts.chainlinkToken.balanceOf(deploymentDetails.nodeAddress)
    const testAddrLinkBalance = await contracts.chainlinkToken.balanceOf(config.testAddress)
    const testAddrFUSDBalance = await contracts.FUSDToken.balanceOf(config.testAddress)
    const testAddrSWIPBalance = await contracts.SWIPToken.balanceOf(config.testAddress)
    const swipswapLinkBalance = await contracts.chainlinkToken.balanceOf(deploymentDetails.swipSwapAddress)

    if(deploymentDetails.nodeAddress !== deployments.nodeAddress || nodeLinkBalance === 0) {
        const tx = await contracts.chainlinkToken.transfer(deploymentDetails.nodeAddress, ethers.utils.parseEther("10000"))
        await tx.wait()
        console.log(`Funded node address: ${deploymentDetails.nodeAddress} with $LINK`)
    }

    if(deploymentDetails.nodeAddress !== deployments.nodeAddress || testAddrLinkBalance === 0) {
        const tx = await contracts.chainlinkToken.transfer(config.testAddress, ethers.utils.parseEther("1000"))
        await tx.wait()
        console.log(`Funded test address: ${config.testAddress} with $LINK`)
    }


    if(deploymentDetails.FUSDTokenAddress !== deployments.FUSDTokenAddress || testAddrFUSDBalance === 0) {
        const tx = await contracts.FUSDToken.transfer(config.testAddress, "500000000")
        await tx.wait()
        console.log(`Funded test address: ${deploymentDetails.FUSDTokenAddress} with $FUSD`)
    }

    if(deploymentDetails.swipSwapAddress !== deployments.swipSwapAddress || swipswapLinkBalance === 0) {
        const tx = await contracts.chainlinkToken.transfer(deploymentDetails.swipSwapAddress, ethers.utils.parseEther("1000"))
        await tx.wait()
        console.log(`Funded swipswap contract address: ${deploymentDetails.swipSwapAddress} with $LINK`)
    }

    if(deployments.swipTokenAddress !== deploymentDetails.swipTokenAddress || testAddrSWIPBalance === 0) {
        const tx = await contracts.SWIPToken.transfer(config.testAddress, 1_000_000_000)
        await tx.wait()
        console.log(`Transfered SWIP Tokens to test address`)
    }
    
    const result = ({...deploymentDetails, deployer: await deploymentDetails.deployer.getAddress()})
    console.log(result)
}

module.exports = callbackFunction
