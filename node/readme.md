# Chainlink Local Node

This repo contains scripts to set up a chainlink node locally. It aims to make it easy to get started with chainlink. The script sets up postgres, chainlink node and a local ethereum node (ganache client) in docker. It deploys a chainlink token and a chainlink oracle to the local etherem client. The scripts will also fund the deployed chainlink node and a dev address with eth and link tokens f

# Dependencies

- Docker
- Docker compose
- Node js

## Quick Start

- Clone this repository and cd into it
- Update the value `testAddress` in the `config.json` file. This can be the value of your metamask test address.
- run `npm install` to install the necessary nodejs dependencies.
- run `npm start` to start all deployment and node configuration.
- After a successful set up, chainlink node will be accessible on port 6688, postgres on port 6689 and ganache on port 6690.
