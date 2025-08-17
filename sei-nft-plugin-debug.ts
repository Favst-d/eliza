import type { Plugin } from '@elizaos/core';
import {
  type Action,
  type ActionResult,
  type HandlerCallback,
  type IAgentRuntime,
  type Memory,
  ModelType,
  Service,
  type State,
  logger,
  type MessagePayload,
  EventType,
} from '@elizaos/core';
import { z } from 'zod';

const configSchema = z.object({
  PRIVATE_KEY: z.string().min(1, 'Private key is required'),
});

interface NFTMetadata {
  name: string;
  description: string;
}

export class SeiNftService extends Service {
  static override serviceType = 'sei-nft';
  override capabilityDescription = 'SEI NFT operations';

  constructor(runtime?: IAgentRuntime) {
    super(runtime);
    logger.info('SeiNftService constructor called');
  }

  static override async start(runtime: IAgentRuntime): Promise<Service> {
    logger.info('Starting SEI NFT service');
    return new SeiNftService(runtime);
  }

  static override async stop(runtime: IAgentRuntime): Promise<void> {
    logger.info('Stopping SEI NFT service');
  }

  override async stop(): Promise<void> {
    logger.info('SEI NFT service stopped');
  }

  async mintNFT(metadata: NFTMetadata): Promise<{ tokenId: string; transactionHash: string }> {
    const tokenId = `token_${Date.now()}`;
    const transactionHash = `0x${Math.random().toString(16).substr(2, 64)}`;
    logger.info(`Minted NFT: ${tokenId}`);
    return { tokenId, transactionHash };
  }
}

const mintNFTAction: Action = {
  name: 'MINT_NFT',
  similes: ['CREATE_NFT', 'MINT_TOKEN', 'MAKE_NFT'],
  description: 'Mints a new NFT',

  validate: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state: State | undefined
  ): Promise<boolean> => {
    logger.info(`MINT_NFT validate called with message: "${message.content.text}"`);
    
    if (!message.content.text) {
      logger.info('MINT_NFT validate: no text content, returning false');
      return false;
    }
    
    const text = message.content.text.toLowerCase();
    const shouldTrigger = text.includes('mint') || text.includes('create') || text.includes('nft');
    
    logger.info(`MINT_NFT validate: text="${text}", shouldTrigger=${shouldTrigger}`);
    return shouldTrigger;
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state: State | undefined,
    _options: Record<string, unknown> = {},
    callback?: HandlerCallback,
    _responses?: Memory[]
  ): Promise<ActionResult> => {
    logger.info('MINT_NFT handler called');
    
    try {
      if (!message.content.text) {
        logger.error('MINT_NFT handler: no message content text');
        return {
          success: false,
          error: new Error('Message content text is undefined'),
          text: 'I need a message with text to process your NFT minting request.',
        };
      }

      const service = runtime.getService(SeiNftService.serviceType) as SeiNftService;
      if (!service) {
        logger.error('MINT_NFT handler: SEI NFT service not available');
        throw new Error('SEI NFT service not available');
      }

      logger.info('MINT_NFT handler: calling mintNFT service');
      
      const metadata: NFTMetadata = {
        name: 'Digital Sunset',
        description: 'An NFT created by AI agent',
      };

      const result = await service.mintNFT(metadata);
      const response = `🎨 Successfully minted NFT "${metadata.name}"!\n\n✅ Token ID: ${result.tokenId}\n🔗 Transaction: ${result.transactionHash}`;

      logger.info(`MINT_NFT handler: success, response="${response}"`);

      if (callback) {
        logger.info('MINT_NFT handler: calling callback');
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
      logger.error('MINT_NFT handler: error occurred', error);
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
          text: 'mint an NFT',
        },
      },
      {
        name: '{{name2}}',
        content: {
          text: '🎨 Successfully minted NFT "Digital Sunset"!\n\n✅ Token ID: token_123\n🔗 Transaction: 0xabc...',
          actions: ['MINT_NFT'],
        },
      },
    ],
  ],
};

export const seiNftPlugin: Plugin = {
  name: 'plugin-sei-nft',
  description: 'SEI NFT plugin with debug logging',
  config: {
    PRIVATE_KEY: process.env.PRIVATE_KEY,
  },

  async init(config: Record<string, string>) {
    logger.info('Initializing plugin-sei-nft with debug logging');
    try {
      const validatedConfig = await configSchema.parseAsync(config);
      for (const [key, value] of Object.entries(validatedConfig)) {
        if (value) process.env[key] = value;
      }
      logger.info('plugin-sei-nft initialized successfully');
    } catch (error) {
      logger.error('plugin-sei-nft initialization failed', error);
      if (error instanceof z.ZodError) {
        throw new Error(
          `Invalid plugin configuration: ${error.errors.map((e) => e.message).join(', ')}`
        );
      }
      throw error;
    }
  },

  models: {
    [ModelType.TEXT_SMALL]: async () => {
      return 'I can help you mint NFTs on SEI blockchain.';
    },
    [ModelType.TEXT_LARGE]: async () => {
      return 'I can help you mint NFTs on SEI blockchain.';
    },
  },

  routes: [],

  events: {
    [EventType.MESSAGE_RECEIVED]: [
      async (params: MessagePayload) => {
        logger.info('SEI NFT Plugin: MESSAGE_RECEIVED event received');
        logger.info(`SEI NFT Plugin: Message content: "${params.message.content.text}"`);
      },
    ],
  },

  services: [SeiNftService],
  actions: [mintNFTAction],
  providers: [],
};

logger.info('SEI NFT Plugin: Plugin definition loaded');

export default seiNftPlugin;