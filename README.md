# SEI NFT Plugin

A comprehensive NFT marketplace plugin for the SEI blockchain that enables minting, buying, and selling NFTs using the Symphony SDK and Viem wallet integration.

## Features

- **Mint NFTs**: Create new NFTs with custom metadata
- **Buy NFTs**: Purchase NFTs from the marketplace using SEI tokens
- **Sell NFTs**: List your NFTs for sale on the marketplace
- **Wallet Integration**: Secure wallet management using private keys
- **Symphony SDK**: Leverages Symphony SDK for DEX operations
- **REST API**: Complete API endpoints for all NFT operations

## Installation

```bash
npm install symphony-sdk viem zod axios
```

## Configuration

Set the following environment variables:

```bash
# Required
PRIVATE_KEY=0x1234567890abcdef... # Your wallet private key

# Optional
RPC_URL=https://evm-rpc-testnet.sei-apis.com # SEI testnet RPC URL
NFT_CONTRACT_ADDRESS=0x... # Your NFT contract address
MARKETPLACE_CONTRACT_ADDRESS=0x... # Your marketplace contract address
```

## Usage

### Initialize the Plugin

```typescript
import seiNftPlugin from './seiNftPlugin';

// The plugin will automatically initialize with environment variables
const plugin = seiNftPlugin;
```

### Chat Commands

#### Mint an NFT

```
Mint NFT with name: Cool Dragon, description: A fierce dragon NFT
```

#### Buy an NFT

```
Buy NFT with token id: 123 for price: 1.5 SEI
```

#### Sell/List an NFT

```
Sell NFT with token id: 456 for price: 2.0 SEI
```

### REST API Endpoints

#### Mint NFT
```http
POST /api/nft/mint
Content-Type: application/json

{
  "metadata": {
    "name": "Cool Dragon",
    "description": "A fierce dragon NFT",
    "image": "https://example.com/dragon.png",
    "attributes": [
      {"trait_type": "Rarity", "value": "Legendary"},
      {"trait_type": "Element", "value": "Fire"}
    ]
  },
  "recipient": "0x..." // optional
}
```

#### Buy NFT
```http
POST /api/nft/buy
Content-Type: application/json

{
  "tokenId": "123",
  "price": "1.5"
}
```

#### Sell NFT
```http
POST /api/nft/sell
Content-Type: application/json

{
  "tokenId": "456",
  "price": "2.0"
}
```

#### Get NFT Details
```http
GET /api/nft/123
```

## Architecture

### SeiNftService

The core service class that handles all NFT operations:

- **mintNFT()**: Mints new NFTs with metadata
- **buyNFT()**: Purchases NFTs using Symphony SDK for token swaps
- **listNFT()**: Lists NFTs for sale on the marketplace
- **getNFTDetails()**: Retrieves NFT information

### Actions

Three main actions for chat-based interactions:

- **MINT_NFT**: Handles NFT minting requests
- **BUY_NFT**: Processes NFT purchase requests  
- **SELL_NFT**: Manages NFT listing requests

### Wallet Integration

- Uses Viem for wallet client creation
- Private key loaded from environment variables
- Automatic wallet connection to Symphony SDK
- Support for SEI testnet and mainnet

## Data Structures

### NFT Metadata
```typescript
interface NFTMetadata {
  name: string;
  description: string;
  image: string;
  attributes?: Array<{
    trait_type: string;
    value: string | number;
  }>;
}
```

### NFT Data
```typescript
interface NFTData {
  tokenId: string;
  owner: string;
  metadata: NFTMetadata;
  price?: string;
  isListed: boolean;
}
```

## Security

- Private keys are securely loaded from environment variables
- All transactions are signed using the configured wallet
- Input validation on all API endpoints
- Error handling with detailed logging

## Development

### Testing

The plugin includes comprehensive error handling and logging. For development:

1. Set up your environment variables
2. Deploy test NFT and marketplace contracts (optional)
3. Test with SEI testnet tokens

### Extending

To add new functionality:

1. Add new methods to `SeiNftService`
2. Create corresponding actions for chat interactions
3. Add new API routes if needed
4. Update the plugin configuration

## Troubleshooting

### Common Issues

1. **"Private key is required"**: Ensure `PRIVATE_KEY` environment variable is set
2. **"Service not available"**: Check that the plugin is properly initialized
3. **Transaction failures**: Verify you have sufficient SEI tokens for gas fees

### Logs

The plugin uses structured logging. Check logs for:
- Wallet initialization
- Transaction hashes
- Service startup/shutdown
- Error details

## License

MIT License - see LICENSE file for details.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Add tests for new functionality
4. Submit a pull request

## Support

For issues and questions:
- Create an issue in the repository
- Check the troubleshooting section
- Review the logs for error details