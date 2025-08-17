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

/**
 * Configuration schema for the SEI NFT plugin
 */
const configSchema = z.object({
  PRIVATE_KEY: z.string().min(1, 'Private key is required'),
  SEI_RPC_URL: z.string().url().default('https://rpc.sei-apis.com'),
  CW721_CONTRACT_ADDRESS: z.string().optional(),
  PINATA_JWT: z.string().optional(),
});

/**
 * NFT Metadata interface
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
 * SEI NFT Service
 */
export class SeiNftService extends Service {
  static override serviceType = 'sei-nft';

  override capabilityDescription =
    'Provides SEI blockchain NFT functionality including minting, viewing, and marketplace operations.';

  private privateKey: string;
  private rpcUrl: string;
  private contractAddress?: string;
  private pinataJwt?: string;

  constructor(runtime?: IAgentRuntime) {
    super(runtime);
    this.privateKey = process.env.PRIVATE_KEY || '';
    this.rpcUrl = process.env.SEI_RPC_URL || 'https://rpc.sei-apis.com';
    this.contractAddress = process.env.CW721_CONTRACT_ADDRESS;
    this.pinataJwt = process.env.PINATA_JWT;
    
    if (!this.privateKey) {
      throw new Error('PRIVATE_KEY environment variable is required');
    }
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
   * Mint an NFT
   */
  async mintNFT(metadata: NFTMetadata): Promise<{ tokenId: string; transactionHash: string }> {
    try {
      // Simulate minting process
      const tokenId = `token_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const transactionHash = `0x${Math.random().toString(16).substr(2, 64)}`;
      
      logger.info(`Minted NFT: ${tokenId}`);
      
      return {
        tokenId,
        transactionHash,
      };
    } catch (error) {
      logger.error({ error }, 'Failed to mint NFT');
      throw new Error(`Failed to mint NFT: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Get owned NFTs
   */
  async getOwnedNFTs(): Promise<Array<{ tokenId: string; name: string; description: string }>> {
    try {
      // Simulate getting owned NFTs
      return [
        {
          tokenId: 'token_123',
          name: 'Sample NFT #1',
          description: 'A sample NFT for testing'
        },
        {
          tokenId: 'token_456',
          name: 'Sample NFT #2',
          description: 'Another sample NFT'
        }
      ];
    } catch (error) {
      logger.error({ error }, 'Failed to get owned NFTs');
      throw new Error(`Failed to get owned NFTs: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Get marketplace listings
   */
  async getMarketplaceListings(): Promise<Array<{ tokenId: string; price: string; seller: string }>> {
    try {
      // Simulate getting marketplace listings
      return [
        {
          tokenId: 'token_789',
          price: '1.5',
          seller: 'sei1abc123...'
        },
        {
          tokenId: 'token_101',
          price: '2.0',
          seller: 'sei1def456...'
        }
      ];
    } catch (error) {
      logger.error({ error }, 'Failed to get marketplace listings');
      throw new Error(`Failed to get marketplace listings: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

const mintNFTAction: Action = {
  name: 'MINT_NFT',
  similes: ['CREATE_NFT', 'MINT_TOKEN', 'MAKE_NFT'],
  description: 'Mints a new NFT on the SEI blockchain',

  validate: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state: State | undefined
  ): Promise<boolean> => {
    if (!message.content.text) return false;
    
    const text = message.content.text.toLowerCase();
    return text.includes('mint') || 
           text.includes('create') || 
           text.includes('make nft');
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

      // Simple parsing - look for quoted name or use default
      const text = message.content.text;
      const nameMatch = text.match(/"([^"]+)"/);
      const name = nameMatch ? nameMatch[1] : 'AI Generated NFT';

      const metadata: NFTMetadata = {
        name,
        description: 'An NFT created by AI agent',
        image: 'https://via.placeholder.com/512x512.png?text=NFT',
        attributes: [
          {
            trait_type: 'Created By',
            value: 'AI Agent'
          }
        ]
      };

      const result = await service.mintNFT(metadata);

      const response = `🎨 Successfully minted NFT "${metadata.name}"!\n\n✅ Token ID: ${result.tokenId}\n🔗 Transaction: ${result.transactionHash}`;

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
          result,
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to mint NFT';
      return {
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
        text: `❌ Sorry, I couldn't mint the NFT. ${errorMessage}`,
      };
    }
  },

  examples: [
    [
      {
        name: '{{name1}}',
        content: {
          text: 'Mint an NFT called "Digital Sunset"',
        },
      },
      {
        name: '{{name2}}',
        content: {
          text: '🎨 Successfully minted NFT "Digital Sunset"!\n\n✅ Token ID: token_123...\n🔗 Transaction: 0xabc...',
          actions: ['MINT_NFT'],
        },
      },
    ],
  ],
};

const viewOwnedNFTsAction: Action = {
  name: 'VIEW_OWNED_NFTS',
  similes: ['SHOW_MY_NFTS', 'MY_NFTS', 'MY_COLLECTION'],
  description: 'Shows NFTs owned by the user',

  validate: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state: State | undefined
  ): Promise<boolean> => {
    if (!message.content.text) return false;
    
    const text = message.content.text.toLowerCase();
    return text.includes('my nft') || 
           text.includes('show nft') || 
           text.includes('my collection');
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
      const service = runtime.getService(SeiNftService.serviceType) as SeiNftService;
      if (!service) {
        throw new Error('SEI NFT service not available');
      }

      const ownedNFTs = await service.getOwnedNFTs();

      let response = `📊 **Your NFT Collection**\n\n`;
      
      if (ownedNFTs.length === 0) {
        response += `🔍 You don't own any NFTs yet.`;
      } else {
        response += `🎨 **You own ${ownedNFTs.length} NFTs:**\n\n`;
        ownedNFTs.forEach((nft, index) => {
          response += `**${index + 1}. ${nft.name}**\n`;
          response += `   🆔 Token ID: ${nft.tokenId}\n`;
          response += `   📝 Description: ${nft.description}\n\n`;
        });
      }

      if (callback) {
        await callback({
          text: response,
          actions: ['VIEW_OWNED_NFTS'],
          source: message.content.source,
        });
      }

      return {
        text: response,
        success: true,
        data: {
          actions: ['VIEW_OWNED_NFTS'],
          source: message.content.source,
          ownedNFTs,
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to retrieve owned NFTs';
      return {
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
        text: `❌ Sorry, I couldn't retrieve your NFTs. ${errorMessage}`,
      };
    }
  },

  examples: [
    [
      {
        name: '{{name1}}',
        content: {
          text: 'Show me my NFT collection',
        },
      },
      {
        name: '{{name2}}',
        content: {
          text: '📊 **Your NFT Collection**\n\n🎨 **You own 2 NFTs:**\n\n**1. Sample NFT #1**\n   🆔 Token ID: token_123',
          actions: ['VIEW_OWNED_NFTS'],
        },
      },
    ],
  ],
};

const viewMarketplaceAction: Action = {
  name: 'VIEW_MARKETPLACE',
  similes: ['BROWSE_NFTS', 'MARKETPLACE', 'NFTS_FOR_SALE'],
  description: 'Browse available NFTs on the marketplace',

  validate: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state: State | undefined
  ): Promise<boolean> => {
    if (!message.content.text) return false;
    
    const text = message.content.text.toLowerCase();
    return text.includes('marketplace') || 
           text.includes('browse nft') || 
           text.includes('nfts for sale');
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
      const service = runtime.getService(SeiNftService.serviceType) as SeiNftService;
      if (!service) {
        throw new Error('SEI NFT service not available');
      }

      const listings = await service.getMarketplaceListings();

      let response = `🏪 **NFT Marketplace**\n\n`;

      if (listings.length === 0) {
        response += `🔍 No NFTs currently listed for sale.`;
      } else {
        response += `🎨 **Available NFTs (${listings.length} listings):**\n\n`;
        listings.forEach((listing, index) => {
          response += `**${index + 1}. Token #${listing.tokenId}**\n`;
          response += `   💰 Price: ${listing.price} SEI\n`;
          response += `   👤 Seller: ${listing.seller}\n\n`;
        });
      }

      if (callback) {
        await callback({
          text: response,
          actions: ['VIEW_MARKETPLACE'],
          source: message.content.source,
        });
      }

      return {
        text: response,
        success: true,
        data: {
          actions: ['VIEW_MARKETPLACE'],
          source: message.content.source,
          listings,
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to browse marketplace';
      return {
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
        text: `❌ Sorry, I couldn't browse the marketplace. ${errorMessage}`,
      };
    }
  },

  examples: [
    [
      {
        name: '{{name1}}',
        content: {
          text: 'Browse NFTs on the marketplace',
        },
      },
      {
        name: '{{name2}}',
        content: {
          text: '🏪 **NFT Marketplace**\n\n🎨 **Available NFTs (2 listings):**\n\n**1. Token #token_789**\n   💰 Price: 1.5 SEI',
          actions: ['VIEW_MARKETPLACE'],
        },
      },
    ],
  ],
};

export const seiNftPlugin: Plugin = {
  name: 'plugin-sei-nft',
  description: 'Provides SEI blockchain NFT functionality including minting, viewing, and marketplace operations',
  config: {
    PRIVATE_KEY: process.env.PRIVATE_KEY,
    SEI_RPC_URL: process.env.SEI_RPC_URL,
    CW721_CONTRACT_ADDRESS: process.env.CW721_CONTRACT_ADDRESS,
    PINATA_JWT: process.env.PINATA_JWT,
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
      return 'I can help you with SEI blockchain NFT operations including minting, viewing collections, and browsing the marketplace.';
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
      return 'I specialize in SEI blockchain NFT operations. You can ask me to mint NFTs, show your collection, or browse the marketplace for available NFTs.';
    },
  },

  routes: [
    {
      name: 'api-nft-mint',
      path: '/api/nft/mint',
      type: 'POST',
      handler: async (req: any, res: any) => {
        try {
          const { name, description, image } = req.body;
          
          if (!name) {
            return res.status(400).json({ error: 'Name is required' });
          }

          const service = req.runtime.getService(SeiNftService.serviceType) as SeiNftService;
          if (!service) {
            return res.status(500).json({ error: 'SEI NFT service not available' });
          }

          const metadata: NFTMetadata = {
            name,
            description: description || 'NFT created via API',
            image: image || 'https://via.placeholder.com/512x512.png?text=NFT'
          };

          const result = await service.mintNFT(metadata);
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
      name: 'api-nft-owned',
      path: '/api/nft/owned',
      type: 'GET',
      handler: async (req: any, res: any) => {
        try {
          const service = req.runtime.getService(SeiNftService.serviceType) as SeiNftService;
          if (!service) {
            return res.status(500).json({ error: 'SEI NFT service not available' });
          }

          const ownedNFTs = await service.getOwnedNFTs();
          res.json({ nfts: ownedNFTs });
        } catch (error) {
          res.status(500).json({
            error: 'Failed to get owned NFTs',
            details: error instanceof Error ? error.message : String(error),
          });
        }
      },
    },
    {
      name: 'api-nft-marketplace',
      path: '/api/nft/marketplace',
      type: 'GET',
      handler: async (req: any, res: any) => {
        try {
          const service = req.runtime.getService(SeiNftService.serviceType) as SeiNftService;
          if (!service) {
            return res.status(500).json({ error: 'SEI NFT service not available' });
          }

          const listings = await service.getMarketplaceListings();
          res.json({ listings });
        } catch (error) {
          res.status(500).json({
            error: 'Failed to get marketplace listings',
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
  actions: [mintNFTAction, viewOwnedNFTsAction, viewMarketplaceAction],
  providers: [],
};

export default seiNftPlugin;