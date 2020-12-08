const {setupNode, callbackFunction} = require("./node")

task("startnode", "Auto deploy and set up", async () => {
    try {
        await setupNode(callbackFunction)
    } catch (error) {
        console.log('deployment on development network failed failed', error)
    }
});

module.exports = {
    solidity: "0.6.9",
    defaultNetwork: "localhost",
    hardhat: {},
    networks: {
        localhost: {
            url: "http://127.0.0.1:6690",
        },
        ropsten: {
            url: "https://ropsten.infura.io/v3/a9c2daa6167748c1ab6542469a583203"
        },
        goerli: {
            url: "https://goerli.infura.io/v3/a9c2daa6167748c1ab6542469a583203"
        }
    }
};

