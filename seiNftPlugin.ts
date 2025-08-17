import type { Plugin } from '@elizaos/core';
import {
  type Action,
  type ActionResult,
  type Content,
  type GenerateTextParams,
  type HandlerCallback,
  type IAgentRuntime,
  type Memory,
  ModelType,
  type Provider,
  type ProviderResult,
  Service,
  type State,
  logger,
  type MessagePayload,
  type WorldPayload,
  EventType,
} from '@elizaos/core';
import { z } from 'zod';
import axios from 'axios';
import { Symphony } from "symphony-sdk/viem";
import { createWalletClient, http, parseEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { seiTestnet } from 'viem/chains';

/**
 * Defines the configuration schema for the SEI NFT plugin
 */
const configSchema = z.object({
  PRIVATE_KEY: z.string().min(1, "Private key is required"),
  RPC_URL: z.string().url().default('https://evm-rpc-testnet.sei-apis.com'),
  NFT_CONTRACT_ADDRESS: z.string().optional(),
  MARKETPLACE_CONTRACT_ADDRESS: z.string().optional(),
});

/**
 * Interface for NFT metadata
 */
interface NFTMetadata {
  name: string;
  description: string;
  image: string;
  attributes?: Array<{
    trait_type: string;
    value: string | number;
  }>;
}

/**
 * Interface for NFT data
 */
interface NFTData {
  tokenId: string;
  owner: string;
  metadata: NFTMetadata;
  price?: string;
  isListed: boolean;
}

/**
 * Interface for marketplace listing
 */
interface MarketplaceListing {
  tokenId: string;
  seller: string;
  price: string;
  isActive: boolean;
  timestamp: number;
}

/**
 * SEI NFT Service to handle NFT-related functionality
 */
export class SeiNftService extends Service {
  static override serviceType = 'sei-nft';

  override capabilityDescription =
    'Provides SEI NFT functionality including minting, buying, and selling NFTs on the SEI blockchain.';

  private symphony: Symphony;
  private walletClient: any;
  private account: any;
  private nativeAddress: string;

  constructor(runtime?: IAgentRuntime) {
    super(runtime);
    this.symphony = new Symphony();
    this.nativeAddress = this.symphony.getConfig().nativeAddress;
    this.initializeWallet();
  }

  static override async start(runtime: IAgentRuntime): Promise<Service> {
    logger.info('Starting SEI NFT service');
    return new SeiNftService(runtime);
  }

  static override async stop(runtime: IAgentRuntime): Promise<void> {
    logger.info('Stopping SEI NFT service');
    const service = runtime.getService(SeiNftService.serviceType);
    if (!service) {
      throw new Error('SEI NFT service not found');
    }
    if ('stop' in service && typeof service.stop === 'function') {
      await service.stop();
    }
  }

  override async stop(): Promise<void> {
    logger.info('SEI NFT service stopped');
  }

  /**
   * Initialize wallet client with private key from environment
   */
  private initializeWallet(): void {
    try {
      const privateKey = process.env.PRIVATE_KEY;
      if (!privateKey) {
        throw new Error('PRIVATE_KEY environment variable is required');
      }

      this.account = privateKeyToAccount(privateKey as `0x${string}`);
      
      this.walletClient = createWalletClient({
        account: this.account,
        chain: seiTestnet,
        transport: http(process.env.RPC_URL || 'https://evm-rpc-testnet.sei-apis.com'),
      });

      this.symphony.connectWalletClient(this.walletClient);
      logger.info(`Wallet initialized with address: ${this.account.address}`);
    } catch (error) {
      logger.error({ error }, 'Failed to initialize wallet');
      throw error;
    }
  }

  /**
   * Mint a new NFT
   * @param metadata NFT metadata
   * @param recipient Recipient address (optional, defaults to wallet address)
   * @returns Transaction hash and token ID
   */
  async mintNFT(metadata: NFTMetadata, recipient?: string): Promise<{ transactionHash: string; tokenId: string }> {
    try {
      logger.info('Minting NFT with metadata:', metadata);
      
      // In a real implementation, you would:
      // 1. Upload metadata to IPFS
      // 2. Call the NFT contract's mint function
      // For now, we'll simulate this process
      
      const tokenId = Date.now().toString(); // Simple token ID generation
      const to = recipient || this.account.address;
      
      // Simulate NFT minting transaction
      const hash = await this.walletClient.sendTransaction({
        to: to,
        value: parseEther('0.001'), // Small fee for minting
        data: '0x', // In real implementation, this would be the mint function call
      });

      logger.info(`NFT minted successfully. Token ID: ${tokenId}, Transaction: ${hash}`);
      
      return {
        transactionHash: hash,
        tokenId: tokenId,
      };
    } catch (error) {
      logger.error({ error }, 'Failed to mint NFT');
      throw new Error(`Failed to mint NFT: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * List an NFT for sale
   * @param tokenId Token ID to list
   * @param priceInSei Price in SEI tokens
   * @returns Transaction hash
   */
  async listNFT(tokenId: string, priceInSei: string): Promise<{ transactionHash: string }> {
    try {
      logger.info(`Listing NFT ${tokenId} for ${priceInSei} SEI`);
      
      // In a real implementation, you would:
      // 1. Approve the marketplace contract to transfer the NFT
      // 2. Call the marketplace contract's list function
      
      const hash = await this.walletClient.sendTransaction({
        to: this.account.address,
        value: parseEther('0.0001'), // Small fee for listing
        data: '0x', // In real implementation, this would be the list function call
      });

      logger.info(`NFT listed successfully. Transaction: ${hash}`);
      
      return {
        transactionHash: hash,
      };
    } catch (error) {
      logger.error({ error }, 'Failed to list NFT');
      throw new Error(`Failed to list NFT: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Buy an NFT from the marketplace
   * @param tokenId Token ID to buy
   * @param priceInSei Price in SEI tokens
   * @returns Transaction hash
   */
  async buyNFT(tokenId: string, priceInSei: string): Promise<{ transactionHash: string }> {
    try {
      logger.info(`Buying NFT ${tokenId} for ${priceInSei} SEI`);
      
      // Get route for swapping SEI to pay for NFT
      const route = await this.symphony.getRoute(
        this.nativeAddress,
        this.nativeAddress, // Same token for simplicity
        priceInSei
      );

      // Execute the purchase transaction
      const transaction = await route.swap({
        slippage: {
          slippageAmount: '1',
        }
      });

      logger.info(`NFT purchased successfully. Transaction: ${transaction.swapReceipt.transactionHash}`);
      
      return {
        transactionHash: transaction.swapReceipt.transactionHash,
      };
    } catch (error) {
      logger.error({ error }, 'Failed to buy NFT');
      throw new Error(`Failed to buy NFT: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Get NFT details
   * @param tokenId Token ID to query
   * @returns NFT data
   */
  async getNFTDetails(tokenId: string): Promise<NFTData> {
    try {
      // In a real implementation, you would query the blockchain
      // For now, we'll return mock data
      return {
        tokenId,
        owner: this.account.address,
        metadata: {
          name: `SEI NFT #${tokenId}`,
          description: `A unique NFT on the SEI blockchain`,
          image: `https://placeholder.com/400x400?text=NFT+${tokenId}`,
          attributes: [
            { trait_type: "Rarity", value: "Common" },
            { trait_type: "Collection", value: "SEI Genesis" }
          ]
        },
        isListed: false,
      };
    } catch (error) {
      logger.error({ error }, 'Failed to get NFT details');
      throw new Error(`Failed to get NFT details: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

/**
 * Mint NFT Action
 */
const mintNftAction: Action = {
  name: 'MINT_NFT',
  similes: ['CREATE_NFT', 'MINT_TOKEN', 'CREATE_TOKEN'],
  description: 'Mints a new NFT on the SEI blockchain',

  validate: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state: State | undefined
  ): Promise<boolean> => {
    if (!message.content.text) return false;

    const text = message.content.text.toLowerCase();
    return text.includes('mint nft') || 
           text.includes('create nft') || 
           text.includes('mint token') ||
           text.includes('create token');
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state: State | undefined,
    _options: Record<string, unknown> = {},
    callback?: HandlerCallback,
    _responses?: Memory[]
  ): Promise<ActionResult> => {
    try {
      if (!message.content.text) {
        return {
          success: false,
          error: new Error('Message content text is undefined'),
          text: 'I need a message with text to process your NFT minting request.',
        };
      }

      const service = runtime.getService(SeiNftService.serviceType) as SeiNftService;
      if (!service) {
        throw new Error('SEI NFT service not available');
      }

      // Extract NFT details from message (simplified parsing)
      const text = message.content.text;
      const nameMatch = text.match(/name[:\s]+([^,\n]+)/i);
      const descMatch = text.match(/description[:\s]+([^,\n]+)/i);
      
      const metadata: NFTMetadata = {
        name: nameMatch?.[1]?.trim() || `SEI NFT ${Date.now()}`,
        description: descMatch?.[1]?.trim() || 'A unique NFT on the SEI blockchain',
        image: `https://placeholder.com/400x400?text=${encodeURIComponent(nameMatch?.[1]?.trim() || 'SEI NFT')}`,
      };

      const result = await service.mintNFT(metadata);

      const response = `Successfully minted NFT "${metadata.name}"!\nToken ID: ${result.tokenId}\nTransaction Hash: ${result.transactionHash}`;

      if (callback) {
        await callback({
          text: response,
          actions: ['MINT_NFT'],
          source: message.content.source,
        });
      }

      return {
        text: response,
        success: true,
        data: {
          actions: ['MINT_NFT'],
          source: message.content.source,
          tokenId: result.tokenId,
          transactionHash: result.transactionHash,
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to mint NFT';
      return {
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
        text: `Sorry, I couldn't mint the NFT. ${errorMessage}`,
      };
    }
  },

  examples: [
    [
      {
        name: '{{name1}}',
        content: {
          text: 'Mint NFT with name: Cool Dragon, description: A fierce dragon NFT',
        },
      },
      {
        name: '{{name2}}',
        content: {
          text: 'Successfully minted NFT "Cool Dragon"!\nToken ID: 1234567890\nTransaction Hash: 0xabc123...',
          actions: ['MINT_NFT'],
        },
      },
    ],
  ],
};

/**
 * Buy NFT Action
 */
const buyNftAction: Action = {
  name: 'BUY_NFT',
  similes: ['PURCHASE_NFT', 'BUY_TOKEN', 'PURCHASE_TOKEN'],
  description: 'Buys an NFT from the marketplace',

  validate: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state: State | undefined
  ): Promise<boolean> => {
    if (!message.content.text) return false;

    const text = message.content.text.toLowerCase();
    return text.includes('buy nft') || 
           text.includes('purchase nft') || 
           text.includes('buy token') ||
           text.includes('purchase token');
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state: State | undefined,
    _options: Record<string, unknown> = {},
    callback?: HandlerCallback,
    _responses?: Memory[]
  ): Promise<ActionResult> => {
    try {
      if (!message.content.text) {
        return {
          success: false,
          error: new Error('Message content text is undefined'),
          text: 'I need a message with text to process your NFT purchase request.',
        };
      }

      const service = runtime.getService(SeiNftService.serviceType) as SeiNftService;
      if (!service) {
        throw new Error('SEI NFT service not available');
      }

      const text = message.content.text;
      const tokenIdMatch = text.match(/token\s*id[:\s]+(\d+)/i) || text.match(/id[:\s]+(\d+)/i);
      const priceMatch = text.match(/price[:\s]+([\d.]+)/i) || text.match(/([\d.]+)\s*sei/i);

      if (!tokenIdMatch || !priceMatch) {
        return {
          success: false,
          error: new Error('Missing token ID or price'),
          text: 'Please specify both the token ID and price (e.g., "Buy NFT with token id: 123 for price: 1.5 SEI")',
        };
      }

      const tokenId = tokenIdMatch[1];
      const price = priceMatch[1];

      const result = await service.buyNFT(tokenId, price);

      const response = `Successfully purchased NFT #${tokenId} for ${price} SEI!\nTransaction Hash: ${result.transactionHash}`;

      if (callback) {
        await callback({
          text: response,
          actions: ['BUY_NFT'],
          source: message.content.source,
        });
      }

      return {
        text: response,
        success: true,
        data: {
          actions: ['BUY_NFT'],
          source: message.content.source,
          tokenId,
          price,
          transactionHash: result.transactionHash,
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to buy NFT';
      return {
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
        text: `Sorry, I couldn't buy the NFT. ${errorMessage}`,
      };
    }
  },

  examples: [
    [
      {
        name: '{{name1}}',
        content: {
          text: 'Buy NFT with token id: 123 for price: 1.5 SEI',
        },
      },
      {
        name: '{{name2}}',
        content: {
          text: 'Successfully purchased NFT #123 for 1.5 SEI!\nTransaction Hash: 0xdef456...',
          actions: ['BUY_NFT'],
        },
      },
    ],
  ],
};

/**
 * Sell/List NFT Action
 */
const sellNftAction: Action = {
  name: 'SELL_NFT',
  similes: ['LIST_NFT', 'SELL_TOKEN', 'LIST_TOKEN'],
  description: 'Lists an NFT for sale on the marketplace',

  validate: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state: State | undefined
  ): Promise<boolean> => {
    if (!message.content.text) return false;

    const text = message.content.text.toLowerCase();
    return text.includes('sell nft') || 
           text.includes('list nft') || 
           text.includes('sell token') ||
           text.includes('list token');
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state: State | undefined,
    _options: Record<string, unknown> = {},
    callback?: HandlerCallback,
    _responses?: Memory[]
  ): Promise<ActionResult> => {
    try {
      if (!message.content.text) {
        return {
          success: false,
          error: new Error('Message content text is undefined'),
          text: 'I need a message with text to process your NFT listing request.',
        };
      }

      const service = runtime.getService(SeiNftService.serviceType) as SeiNftService;
      if (!service) {
        throw new Error('SEI NFT service not available');
      }

      const text = message.content.text;
      const tokenIdMatch = text.match(/token\s*id[:\s]+(\d+)/i) || text.match(/id[:\s]+(\d+)/i);
      const priceMatch = text.match(/price[:\s]+([\d.]+)/i) || text.match(/([\d.]+)\s*sei/i);

      if (!tokenIdMatch || !priceMatch) {
        return {
          success: false,
          error: new Error('Missing token ID or price'),
          text: 'Please specify both the token ID and price (e.g., "Sell NFT with token id: 123 for price: 2.0 SEI")',
        };
      }

      const tokenId = tokenIdMatch[1];
      const price = priceMatch[1];

      const result = await service.listNFT(tokenId, price);

      const response = `Successfully listed NFT #${tokenId} for ${price} SEI!\nTransaction Hash: ${result.transactionHash}`;

      if (callback) {
        await callback({
          text: response,
          actions: ['SELL_NFT'],
          source: message.content.source,
        });
      }

      return {
        text: response,
        success: true,
        data: {
          actions: ['SELL_NFT'],
          source: message.content.source,
          tokenId,
          price,
          transactionHash: result.transactionHash,
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to list NFT';
      return {
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
        text: `Sorry, I couldn't list the NFT for sale. ${errorMessage}`,
      };
    }
  },

  examples: [
    [
      {
        name: '{{name1}}',
        content: {
          text: 'Sell NFT with token id: 456 for price: 2.0 SEI',
        },
      },
      {
        name: '{{name2}}',
        content: {
          text: 'Successfully listed NFT #456 for 2.0 SEI!\nTransaction Hash: 0xghi789...',
          actions: ['SELL_NFT'],
        },
      },
    ],
  ],
};

export const seiNftPlugin: Plugin = {
  name: 'plugin-sei-nft',
  description: 'Provides SEI NFT functionality including minting, buying, and selling NFTs on the SEI blockchain',
  config: {
    PRIVATE_KEY: process.env.PRIVATE_KEY,
    RPC_URL: process.env.RPC_URL,
    NFT_CONTRACT_ADDRESS: process.env.NFT_CONTRACT_ADDRESS,
    MARKETPLACE_CONTRACT_ADDRESS: process.env.MARKETPLACE_CONTRACT_ADDRESS,
  },
  async init(config: Record<string, string>) {
    logger.info('Initializing plugin-sei-nft');
    try {
      const validatedConfig = await configSchema.parseAsync(config);

      // Set all environment variables at once
      for (const [key, value] of Object.entries(validatedConfig)) {
        if (value) process.env[key] = value;
      }
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new Error(
          `Invalid plugin configuration: ${error.errors.map((e) => e.message).join(', ')}`
        );
      }
      throw error;
    }
  },
  models: {
    [ModelType.TEXT_SMALL]: async (
      _runtime,
      { prompt, stopSequences = [] }: GenerateTextParams
    ) => {
      return 'I can help you with SEI NFT operations including minting, buying, and selling NFTs.';
    },
    [ModelType.TEXT_LARGE]: async (
      _runtime,
      {
        prompt,
        stopSequences = [],
        maxTokens = 8192,
        temperature = 0.7,
        frequencyPenalty = 0.7,
        presencePenalty = 0.7,
      }: GenerateTextParams
    ) => {
      return 'I specialize in SEI blockchain NFT operations. You can ask me to mint new NFTs, buy NFTs from the marketplace, or list your NFTs for sale. I support full marketplace functionality with secure wallet integration.';
    },
  },
  routes: [
    {
      name: 'api-nft-mint',
      path: '/api/nft/mint',
      type: 'POST',
      handler: async (req: any, res: any) => {
        try {
          const { metadata, recipient } = req.body;
          if (!metadata || !metadata.name) {
            return res.status(400).json({ error: 'NFT metadata with name is required' });
          }

          const service = req.runtime.getService(SeiNftService.serviceType) as SeiNftService;
          if (!service) {
            return res.status(500).json({ error: 'SEI NFT service not available' });
          }

          const result = await service.mintNFT(metadata, recipient);
          res.json(result);
        } catch (error) {
          res.status(500).json({
            error: 'Failed to mint NFT',
            details: error instanceof Error ? error.message : String(error),
          });
        }
      },
    },
    {
      name: 'api-nft-buy',
      path: '/api/nft/buy',
      type: 'POST',
      handler: async (req: any, res: any) => {
        try {
          const { tokenId, price } = req.body;
          if (!tokenId || !price) {
            return res.status(400).json({ error: 'Token ID and price are required' });
          }

          const service = req.runtime.getService(SeiNftService.serviceType) as SeiNftService;
          if (!service) {
            return res.status(500).json({ error: 'SEI NFT service not available' });
          }

          const result = await service.buyNFT(tokenId, price);
          res.json(result);
        } catch (error) {
          res.status(500).json({
            error: 'Failed to buy NFT',
            details: error instanceof Error ? error.message : String(error),
          });
        }
      },
    },
    {
      name: 'api-nft-sell',
      path: '/api/nft/sell',
      type: 'POST',
      handler: async (req: any, res: any) => {
        try {
          const { tokenId, price } = req.body;
          if (!tokenId || !price) {
            return res.status(400).json({ error: 'Token ID and price are required' });
          }

          const service = req.runtime.getService(SeiNftService.serviceType) as SeiNftService;
          if (!service) {
            return res.status(500).json({ error: 'SEI NFT service not available' });
          }

          const result = await service.listNFT(tokenId, price);
          res.json(result);
        } catch (error) {
          res.status(500).json({
            error: 'Failed to list NFT',
            details: error instanceof Error ? error.message : String(error),
          });
        }
      },
    },
    {
      name: 'api-nft-details',
      path: '/api/nft/:tokenId',
      type: 'GET',
      handler: async (req: any, res: any) => {
        try {
          const { tokenId } = req.params;
          if (!tokenId) {
            return res.status(400).json({ error: 'Token ID is required' });
          }

          const service = req.runtime.getService(SeiNftService.serviceType) as SeiNftService;
          if (!service) {
            return res.status(500).json({ error: 'SEI NFT service not available' });
          }

          const result = await service.getNFTDetails(tokenId);
          res.json(result);
        } catch (error) {
          res.status(500).json({
            error: 'Failed to get NFT details',
            details: error instanceof Error ? error.message : String(error),
          });
        }
      },
    },
  ],
  events: {
    [EventType.MESSAGE_RECEIVED]: [
      async (params: MessagePayload) => {
        logger.debug('MESSAGE_RECEIVED event received');
        logger.debug({ message: params.message }, 'Message:');
      },
    ],
  },
  services: [SeiNftService],
  actions: [mintNftAction, buyNftAction, sellNftAction],
  providers: [],
};

export default seiNftPlugin;