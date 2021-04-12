module.exports = {
  networks: {
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
