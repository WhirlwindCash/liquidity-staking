module.exports = {
  networks: {
    development: {
      host: '127.0.0.1',
      port: 8545,
      network_id: '*',
    },

    mainnet: {
      provider: () => new HDWalletProvider(process.env.PRIVATE_KEY, 'https://bsc-dataseed.binance.org/'),
      network_id: 56,
      skipDryRun: true
    }
  },

  compilers: {
    solc: {
      version: "0.8.3",
      parser: "solcjs",
      settings: {
        optimizer: {
          enabled: true
        },
      }
    }
  }
}
