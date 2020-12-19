const ethers = require("ethers")
const axios = require("axios")
const config = require("../../kovan_node/config/config.json")
const getAddressJob = require("../../config/getbalance.spec.json")
const bridge = require("../../config/bridge.json")
const paymentJob = require("../../config/finalize.spec.json")
const { tokenABI, oracleABI } = require("../../prebuild/abi")
const { tokenBytecode, oracleBytecode } = require("../../prebuild/bytecodes")

const {abi: erc20TokenABI, bytecode: erc20TokenBytecode} = require("../../artifacts/contracts/ERC20Token.sol/TOEKN.json")
const {abi: eventEmitterABI, bytecode: eventEmitterBytecode} = require("../../artifacts/contracts/SwipSwapEventEmitter.sol/SwipSwapEventEmitter.json")
const {abi: swipswapABI, bytecode: swipswapBytecode} = require("../../artifacts/contracts/SwipSwapPool.sol/SwipSwapPool.json")
const {abi: swipTokenABI, bytecode: swipTokenBytecode} = require("../../artifacts/contracts/SwipToken.sol/SwipToken.json")

const getSigner = async () => {
    const provider = new ethers.providers.getDefaultProvider('kovan', {
      etherscan: '7JTNTAD7VNR5F9CZ68JKCZSWI2ATZG7393',
      infura: {
				projectId: '15be5db7406e4da6a3079f577dadb2b5',
				projectSecret: '6038650c6017459d8ec21a95b4c14afe'
			},
      alchemy: 'xhM80mezuvjfdF_K7ke6V33UmRB57mI1'
    })
    const wallet = ethers.Wallet.fromMnemonic(config.mnemonic)
    return wallet.connect(provider)
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
  console.log(`Starting deployment script on ${config.network} network`)
  const knownSigner = await getSigner()

  const chainlinkToken = await deployChainlinkToken(knownSigner)
  console.log("deployed chainlink token")

  const nodeAddress = await getNodeAddress()
  if(nodeAddress === ""){
    return
  }
    
  console.log("Setting up chainlink oracle...")
  const chainlinkOracle = await setupChainlinkOracle(knownSigner, chainlinkToken.address, nodeAddress)
  console.log("Successful!")

  _store = {..._store, chainlinkToken, provider, knownSigner, chainlinkOracle, nodeAddress}

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

  const fusdContract = await deployFUSDToken(knownSigner)
    console.log("Deployed fusd token")
    const fusdContractAddress = fusdContract.address
    await fusdContract.transfer(config.testAddress, '500000000')

    const eventEmitterContract = await deployEventEmitter(knownSigner)
    console.log("Deployed event emitter")
    const eventEmitterAddress = eventEmitterContract.address
    
    const authRes = await authenticate()
    const headers = { Cookie: authRes.headers['set-cookie'].join("; ") }

    const bridgeRes = await axios.post("http://localhost:6688/v2/bridge_types", bridge,{ headers })
    const bridgeID = bridgeRes.data.data.id
    
    getAddressJob.initiators[0].params.address = chainlinkOracleAddress
    const getAddressJobRes = await axios.post("http://localhost:6688/v2/specs", getAddressJob,{ headers })
    const getAddressJobID = getAddressJobRes.data.data.id
    
    const swipswapContract = await deploySwipswapContract(chainlinkTokenAddress, chainlinkOracleAddress, ethers.utils.toUtf8Bytes(getAddressJobID), knownSigner)
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
      chainlinkOracleAddress,
      nodeAddress: store.nodeAddress,
      fusdContractAddress,
      eventEmitterAddress,
      bridgeID,
      paymentJobID,
      swipswapAddress,
      swipTokenContractAddress
    })

    console.log(`Deployments on ${config.network} network successful`)
}

async function deployNode() {
  try {
      await main(callbackFunction)
  } catch (error) {
      console.error('deployment on local network failed', error)
  }
}

deployNode()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
