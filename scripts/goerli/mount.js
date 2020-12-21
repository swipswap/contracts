const ethers = require("ethers")
const axios = require("axios")
const config = require("../../goerli_node/config/config.json")
const getAddressJob = require("../../goerli_node/config/getbalance.spec.json")
const bridge = require("../../goerli_node/config/bridge.json")
const paymentJob = require("../../goerli_node/config/finalize.spec.json")
const { tokenABI, oracleABI } = require("../../prebuild/abi")


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

const { abi: erc20TokenABI } = require("../../artifacts/contracts/ERC20Token.sol/TOEKN.json")
const { abi: eventEmitterABI } = require("../../artifacts/contracts/SwipSwapEventEmitter.sol/SwipSwapEventEmitter.json")
const { abi: swipswapABI } = require("../../artifacts/contracts/SwipSwapPool.sol/SwipSwapPool.json")
const { abi: swipTokenABI } = require("../../artifacts/contracts/SwipToken.sol/SwipToken.json")

const connectAndGetSigner = async () => {
    const provider = new ethers.providers.getDefaultProvider(network, {
      etherscan: '7JTNTAD7VNR5F9CZ68JKCZSWI2ATZG7393',
      infura: {
          projectId: '15be5db7406e4da6a3079f577dadb2b5',
          projectSecret: '6038650c6017459d8ec21a95b4c14afe'
      },
      alchemy: '9GJ40fZ1PGwqID6jUHOyzdyEsPLqE7Kn'
  })

    const wallet = ethers.Wallet.fromMnemonic(config.mnemonic)
    return { provider, signer: wallet.connect(provider) }
}

const contractInstance = async (address, abi, signer) => {
  return new ethers.Contract(address, abi, signer)
}

const connectChainlinkToken = async (address, abi, signer) => {
    const contract = new ethers.Contract(address, abi, signer)
    return contract
}

const connectFUSDToken = async (address, abi, signer) => {
    const contract = new ethers.Contract(address, abi, signer)
    return contract
}

const connectEventEmitter = async (address, abi, signer) => {
    const contract = new ethers.Contract(address, abi, signer)
    return contract
}

const connectSwipswapContract = async (address, abi, signer) => {
    const contract = new ethers.Contract(address, abi, signer)
    return contract
}

const setupChainlinkOracle = async (address, abi, signer) => {
    const contract = new ethers.Contract(address, abi, signer)
    return contract
    // const contractInstance = contract.attach(address)
    // await contractInstance.setFulfillmentPermission(nodeAddress, true)
    // return contractInstance
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
    try {
      await sleep(10)
      const { provider, signer } = await connectAndGetSigner()

      _store.provider = provider
      _store.deployer = signer

      _store.nodeAddress = await getNodeAddress()

      if(_store.nodeAddress === ""){
          return
      }
      
      if(_store.nodeAddress !== goerliDeployments.nodeAddress && goerliDeployments.nodeAddress) {
        console.info('Node Address is different from the one in the deployments!!!')
      }
          
      const nodeAddressBalance = await _store.provider.getBalance(_store.nodeAddress)
      console.info(`Node address has a balance of ${Number(nodeAddressBalance)} ETH (Goerli)!!!`)
      
      await callbackFunction(_store)

    } catch(e) {
      console.log(e)
    }

}

const authenticate = async() => {
    let res = await axios.post("http://localhost:6688/sessions", {email:"user@mail.com", password:"password"}, {withCredentials: true})
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
      console.log('No deployed chainlink token address was found in goerli deployments')
    } else {
      const chainlinkToken = await contractInstance(goerliDeployments.chainlinkTokenAddress, tokenABI, deploymentDetails.deployer)
      contracts.chainlinkToken = chainlinkToken
      deploymentDetails.chainlinkTokenAddress = chainlinkToken.address
      console.log(`Connected to chainlink token contract at ${deploymentDetails.chainlinkTokenAddress}`)
    }

    if(!goerliDeployments.chainlinkOracleAddress) {
      console.log('No deployed oracle address was found in goerli deployments')
    } else {
      const chainlinkOracle = await contractInstance(goerliDeployments.chainlinkOracleAddress, oracleABI, deploymentDetails.deployer)
      contracts.chainlinkOracle = chainlinkOracle
      deploymentDetails.chainlinkOracleAddress = chainlinkOracle.address
      console.log(`Connected to chainlink oracle contract at ${deploymentDetails.chainlinkOracleAddress}`)
    }

    if(!goerliDeployments.chainlinkTokenAddress) {
      console.log('No deployed chainlink token address was found in goerli deployments')
    } else {
      const chainlinkToken = await contractInstance(goerliDeployments.chainlinkTokenAddress, tokenABI, deploymentDetails.deployer)
      console.log(`Connected to chainlink token contract at ${chainlinkToken.address}`)
    }

    try {

        const fusdContract = await connectFUSDToken(goerliDeployments.fusdContractAddress, erc20TokenABI, knownSigner)
        console.log(`Connected to FUSD at ${goerliDeployments.fusdContractAddress}`)
        
        const eventEmitterContract = await connectEventEmitter(goerliDeployments.eventEmitterAddress, eventEmitterABI, knownSigner)
        console.log(`Connected to EventEmitter at ${goerliDeployments.eventEmitterAddress}`)
        
        const authRes = await authenticate()
        const headers = {Cookie: authRes.headers['set-cookie'].join("; ")}

        const bridgeRes = await axios.post("http://localhost:6688/v2/bridge_types", bridge,{headers})
        const bridgeID = bridgeRes.data.data.id
        
        getAddressJob.initiators[0].params.address = chainlinkOracleAddress
        
        const swipswapContract = await connectSwipswapContract(goerliDeployments.swipswapAddress, swipswapABI, knownSigner)
        console.log(`Connected to SwipSwapPool at ${swipswapContract.address}`)

        paymentJob.initiators[0].params.address = eventEmitterContract.address
        paymentJob.tasks[2].params.address = swipswapContract.address
    
        await axios.post("http://localhost:6688/v2/specs",paymentJob,{headers})
        // const paymentJobID = paymentJobRes.data.data.id
    
        const swipTokenContract = await connectSWIPToken(goerliDeployments.swipTokenContractAddress, swipTokenABI, knownSigner)
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

async function connectGoerliNode() {
  try {
      await main(callbackFunction)
  } catch (error) {
      console.error('deployment on local network failed', error)
  }
}

connectGoerliNode()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
	})