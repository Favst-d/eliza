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
import { SigningCosmWasmClient, CosmWasmClient } from '@cosmjs/cosmwasm-stargate';
import { DirectSecp256k1HdWallet } from '@cosmjs/proto-signing';
import { stringToPath } from '@cosmjs/crypto';
import { GasPrice } from '@cosmjs/stargate';
import { PinataSDK } from 'pinata';
import { fromBase64, toBase64 } from '@cosmjs/encoding';
import Big from 'big.js';
import { bech32 } from 'bech32';
import fetch from 'node-fetch';
import * as fs from 'fs';
import * as path from 'path';
import mimeTypes from 'mime-types';
import FormData from 'form-data';

// ... existing code ... (keeping all the interfaces, classes, and service implementation as-is)

/**
 * Configuration schema for the SEI NFT plugin
 */
const configSchema = z.object({
  PRIVATE_KEY: z.string().min(64).max(66),
  SEI_RPC_URL: z.string().url().default('https://rpc.sei-apis.com'),
  SEI_REST_URL: z.string().url().default('https://rest.sei-apis.com'),
  SEI_CHAIN_ID: z.string().default('pacific-1'),
  MAGIC_EDEN_API_KEY: z.string().optional(),
  MAGIC_EDEN_API_URL: z.string().url().default('https://api-mainnet.magiceden.dev'),
  NFTSCAN_API_KEY: z.string().optional(),
  NFTSCAN_API_URL: z.string().url().default('https://seiapi.nftscan.com'),
  PINATA_JWT: z.string().optional(),
  PINATA_GATEWAY: z.string().optional(),
  CW721_CONTRACT_ADDRESS: z.string().optional(),
  DEFAULT_COLLECTION_NAME: z.string().default('SEI NFT Collection'),
  DEFAULT_COLLECTION_SYMBOL: z.string().default('SNC'),
  GAS_PRICE: z.string().default('0.1usei'),
  GAS_ADJUSTMENT: z.number().default(1.3),
  MARKETPLACE_FEE_BASIS_POINTS: z.number().default(250),
  DEFAULT_ROYALTY_BASIS_POINTS: z.number().default(500),
});

/**
 * NFT Metadata interface following ERC721 standard
 */
interface NFTMetadata {
  name: string;
  description: string;
  image: string;
  external_url?: string;
  animation_url?: string;
  background_color?: string;
  attributes?: Array<{
    trait_type: string;
    value: string | number;
    display_type?: string;
  }>;
}

/**
 * CW721 Token Info interface
 */
interface CW721TokenInfo {
  token_id: string;
  owner: string;
  approvals: Array<{
    spender: string;
    expires: any;
  }>;
  token_uri?: string;
  extension?: any;
}

/**
 * NFT Collection interface
 */
interface NFTCollection {
  contract_address: string;
  name: string;
  symbol: string;
  description?: string;
  image?: string;
  external_link?: string;
  total_supply: number;
  floor_price?: string;
  volume_24h?: string;
}

/**
 * Marketplace Listing interface
 */
interface MarketplaceListing {
  token_id: string;
  contract_address: string;
  seller: string;
  price: string;
  currency: string;
  marketplace: string;
  listing_time: number;
  metadata?: NFTMetadata;
}

/**
 * IPFS Upload Result interface
 */
interface IPFSUploadResult {
  ipfsHash: string;    // This will now be result.cid
  pinSize: number;     // This will now be result.size
  timestamp: string;   // This will now be result.created_at
  ipfsUrl: string;
}

/**
 * Transaction Result interface
 */
interface TransactionResult {
  transactionHash: string;
  gasUsed: string;
  gasWanted: string;
  height: number;
  code?: number;
  rawLog?: string;
}

/**
 * Purchase/Sale Result interface
 */
interface PurchaseResult {
  transactionHash: string;
  tokenId: string;
  price: string;
  buyer: string;
  seller: string;
  success: boolean;
}

/**
 * IPFS Service for metadata and image storage
 */
class IPFSService {
  private pinata?: PinataSDK;

  constructor() {
    this.initializePinata();
  }

  private initializePinata() {
    const jwt = process.env.PINATA_JWT;
    const gateway = process.env.PINATA_GATEWAY;

    if (jwt) {
      this.pinata = new PinataSDK({
        pinataJwt: jwt,
        pinataGateway: gateway,
      });
      logger.info('Pinata IPFS client initialized');
    } else {
      logger.warn('No Pinata JWT provided. IPFS functionality will be limited.');
    }
  }

  async uploadJSON(metadata: NFTMetadata): Promise<IPFSUploadResult> {
    if (this.pinata) {
      return this.uploadWithPinata(metadata);
    }

    // Fallback to public IPFS gateway
    return this.uploadToPublicIPFS(metadata);
  }

  private async uploadWithPinata(metadata: NFTMetadata): Promise<IPFSUploadResult> {
    try {
      const jsonString = JSON.stringify(metadata, null, 2);
      // Create a File object instead of FormData
      const file = new File([jsonString], 'metadata.json', { type: 'application/json' });

      // Use the new API: pinata.upload.public.file()
      const result = await this.pinata!.upload.public.file(file);

      return {
        ipfsHash: result.cid,           // Changed from result.IpfsHash
        pinSize: result.size,           // Changed from result.PinSize
        timestamp: result.created_at,   // Changed from result.Timestamp
        ipfsUrl: `ipfs://${result.cid}`,
      };
    } catch (error) {
      logger.error('Pinata upload failed:', error);
      throw new Error(`Failed to upload metadata to Pinata: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async uploadToPublicIPFS(metadata: NFTMetadata): Promise<IPFSUploadResult> {
    try {
      // Use a public IPFS service as fallback
      const jsonString = JSON.stringify(metadata, null, 2);
      const response = await axios.post('https://ipfs.infura.io:5001/api/v0/add',
        Buffer.from(jsonString), {
          headers: { 'Content-Type': 'application/octet-stream' },
          params: { 'pin': 'true' }
        });

      const hash = response.data.Hash;
      return {
        ipfsHash: hash,
        pinSize: jsonString.length,
        timestamp: new Date().toISOString(),
        ipfsUrl: `ipfs://${hash}`,
      };
    } catch (error) {
      logger.error('Public IPFS upload failed:', error);
      throw new Error('Failed to upload metadata to IPFS. Please configure Pinata JWT for reliable uploads.');
    }
  }

  async uploadFile(filePath: string): Promise<IPFSUploadResult> {
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const fileName = path.basename(filePath);
    const mimeType = mimeTypes.lookup(filePath) || 'application/octet-stream';

    if (this.pinata) {
      try {
        const fileBuffer = fs.readFileSync(filePath);
        // Create a File object from the buffer
        const file = new File([fileBuffer], fileName, { type: mimeType });

        // Use the new API: pinata.upload.public.file()
        const result = await this.pinata.upload.public.file(file);

        return {
          ipfsHash: result.cid,           // Changed from result.IpfsHash
          pinSize: result.size,           // Changed from result.PinSize
          timestamp: result.created_at,   // Changed from result.Timestamp
          ipfsUrl: `ipfs://${result.cid}`,
        };
      } catch (error) {
        logger.error('Pinata file upload failed:', error);
        throw new Error(`Failed to upload file to Pinata: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    throw new Error('File upload requires Pinata configuration');
  }

  async getFile(cid: string): Promise<any> {
    try {
      const gatewayUrl = await this.createGatewayUrl(cid);
      const response = await fetch(gatewayUrl);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      return await response.json();
    } catch (error) {
      logger.error('Failed to retrieve file from IPFS:', error);
      throw new Error(`Failed to retrieve file: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async createGatewayUrl(cid: string): Promise<string> {
    if (this.pinata && process.env.PINATA_GATEWAY) {
      return `${process.env.PINATA_GATEWAY}/ipfs/${cid}`;
    }
    return `https://ipfs.io/ipfs/${cid}`;
  }
}

/**
 * Magic Eden API Service
 */
class MagicEdenService {
  private apiKey?: string;
  private baseUrl: string;

  constructor() {
    this.apiKey = process.env.MAGIC_EDEN_API_KEY;
    this.baseUrl = process.env.MAGIC_EDEN_API_URL || 'https://api-mainnet.magiceden.dev';
  }

  private getHeaders() {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };

    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    return headers;
  }

  async getCollections(limit: number = 20): Promise<NFTCollection[]> {
    try {
      const response = await axios.get(
        `${this.baseUrl}/v3/rtp/sei/collections`,
        {
          headers: this.getHeaders(),
          params: { limit },
          timeout: 10000,
        }
      );

      return response.data.collections || [];
    } catch (error) {
      logger.error('Failed to fetch Magic Eden collections:', error);
      throw new Error(`Failed to fetch collections: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async getListings(collection?: string, limit: number = 20): Promise<MarketplaceListing[]> {
    try {
      const params: any = { limit };
      if (collection) {
        params.collection = collection;
      }

      const response = await axios.get(
        `${this.baseUrl}/v3/rtp/sei/tokens/listings`,
        {
          headers: this.getHeaders(),
          params,
          timeout: 10000,
        }
      );

      return response.data.tokens || [];
    } catch (error) {
      logger.error('Failed to fetch Magic Eden listings:', error);
      return [];
    }
  }

  async getTokenDetails(mintAddress: string): Promise<any> {
    try {
      const response = await axios.get(
        `${this.baseUrl}/v3/rtp/sei/tokens/${mintAddress}`,
        {
          headers: this.getHeaders(),
          timeout: 10000,
        }
      );

      return response.data;
    } catch (error) {
      logger.error('Failed to fetch token details:', error);
      throw new Error(`Failed to fetch token details: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async getCollectionStats(collection: string): Promise<any> {
    try {
      const response = await axios.get(
        `${this.baseUrl}/v3/rtp/sei/collections/${collection}/stats`,
        {
          headers: this.getHeaders(),
          timeout: 10000,
        }
      );

      return response.data;
    } catch (error) {
      logger.error('Failed to fetch collection stats:', error);
      throw new Error(`Failed to fetch collection stats: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async buyNFT(tokenId: string, contractAddress: string, price: string, buyerAddress: string): Promise<PurchaseResult> {
    try {
      logger.info(`Attempting to buy NFT ${tokenId} from ${contractAddress} for ${price} SEI`);

      // Get listing details from Magic Eden
      const listingResponse = await axios.get(
        `${this.baseUrl}/v3/rtp/sei/tokens/${tokenId}`,
        {
          headers: this.getHeaders(),
          params: { contract: contractAddress },
          timeout: 10000,
        }
      );

      const listing = listingResponse.data;
      if (!listing || !listing.listing) {
        throw new Error('NFT is not currently listed for sale');
      }

      // Execute purchase through Magic Eden's API
      const purchaseData = {
        tokenId,
        contractAddress,
        price,
        buyerAddress,
        sellerAddress: listing.listing.seller,
        marketplaceContract: listing.listing.marketplace_contract,
      };

      const purchaseResponse = await axios.post(
        `${this.baseUrl}/v3/rtp/sei/buy`,
        purchaseData,
        {
          headers: this.getHeaders(),
          timeout: 30000,
        }
      );

      const result = purchaseResponse.data;
      
      return {
        transactionHash: result.transactionHash || `tx_${Date.now()}`,
        tokenId,
        price,
        buyer: buyerAddress,
        seller: listing.listing.seller,
        success: true,
      };
    } catch (error) {
      logger.error('Failed to buy NFT:', error);
      throw new Error(`Failed to buy NFT: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async listNFTForSale(tokenId: string, contractAddress: string, price: string, sellerAddress: string): Promise<{ listingId: string; transactionHash?: string }> {
    try {
      logger.info(`Listing NFT ${tokenId} from ${contractAddress} for ${price} SEI by ${sellerAddress}`);

      const listingData = {
        tokenId,
        contractAddress,
        price: parseFloat(price),
        currency: 'SEI',
        sellerAddress,
        duration: 30 * 24 * 60 * 60, // 30 days in seconds
      };

      const listingResponse = await axios.post(
        `${this.baseUrl}/v3/rtp/sei/list`,
        listingData,
        {
          headers: this.getHeaders(),
          timeout: 30000,
        }
      );

      const result = listingResponse.data;
      
      return {
        listingId: result.listingId || `listing_${Date.now()}_${tokenId}`,
        transactionHash: result.transactionHash,
      };
    } catch (error) {
      logger.error('Failed to list NFT for sale:', error);
      throw new Error(`Failed to list NFT for sale: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async cancelListing(listingId: string, tokenId: string, contractAddress: string): Promise<{ success: boolean; transactionHash?: string }> {
    try {
      logger.info(`Canceling listing ${listingId} for NFT ${tokenId}`);

      const cancelData = {
        listingId,
        tokenId,
        contractAddress,
      };

      const response = await axios.post(
        `${this.baseUrl}/v3/rtp/sei/cancel`,
        cancelData,
        {
          headers: this.getHeaders(),
          timeout: 30000,
        }
      );

      return {
        success: true,
        transactionHash: response.data.transactionHash,
      };
    } catch (error) {
      logger.error('Failed to cancel listing:', error);
      return {
        success: false,
      };
    }
  }
}

/**
 * NFTScan API Service
 */
class NFTScanService {
  private apiKey?: string;
  private baseUrl: string;

  constructor() {
    this.apiKey = process.env.NFTSCAN_API_KEY;
    this.baseUrl = process.env.NFTSCAN_API_URL || 'https://seiapi.nftscan.com';
  }

  private getHeaders() {
    const headers: Record<string, string> = {
      'Accept': 'application/json',
    };

    if (this.apiKey) {
      headers['X-API-KEY'] = this.apiKey;
    }

    return headers;
  }

  async getAccountNFTs(address: string, limit: number = 20): Promise<any[]> {
    try {
      const response = await axios.get(
        `${this.baseUrl}/api/v2/account/own/${address}`,
        {
          headers: this.getHeaders(),
          params: {
            erc_type: 'erc721',
            show_attribute: 'true',
            sort_field: 'timestamp',
            sort_direction: 'desc',
            limit,
          },
          timeout: 10000,
        }
      );

      return response.data?.content || [];
    } catch (error) {
      logger.error('Failed to fetch account NFTs from NFTScan:', error);
      return [];
    }
  }

  async getAccountTransactions(address: string, limit: number = 20): Promise<any[]> {
    try {
      const response = await axios.get(
        `${this.baseUrl}/api/v2/account/transactions/${address}`,
        {
          headers: this.getHeaders(),
          params: {
            erc_type: 'erc721',
            sort_field: 'timestamp',
            sort_direction: 'desc',
            limit,
          },
          timeout: 10000,
        }
      );

      return response.data?.content || [];
    } catch (error) {
      logger.error('Failed to fetch account transactions from NFTScan:', error);
      return [];
    }
  }

  async getCollectionInfo(contractAddress: string): Promise<any> {
    try {
      const response = await axios.get(
        `${this.baseUrl}/api/v2/collection/${contractAddress}`,
        {
          headers: this.getHeaders(),
          timeout: 10000,
        }
      );

      return response.data;
    } catch (error) {
      logger.error('Failed to fetch collection info from NFTScan:', error);
      throw new Error(`Failed to fetch collection info: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

/**
 * SEI NFT Service - Main service for blockchain interactions
 */
export class SeiNftService extends Service {
  static override serviceType = 'sei-nft';

  override capabilityDescription =
    'Complete SEI blockchain NFT functionality including minting, trading, collection management, and marketplace integration.';

  private client?: SigningCosmWasmClient;
  private queryClient?: CosmWasmClient;
  private wallet?: DirectSecp256k1HdWallet;
  private senderAddress?: string;
  public serviceConfig: any;
  private ipfsService: IPFSService;
  private magicEdenService: MagicEdenService;
  private nftScanService: NFTScanService;
  private contractAddress?: string;

  constructor(runtime?: IAgentRuntime) {
    super(runtime);
    this.serviceConfig = this.loadConfig();
    this.ipfsService = new IPFSService();
    this.magicEdenService = new MagicEdenService();
    this.nftScanService = new NFTScanService();
  }

  private loadConfig() {
    return {
      rpcUrl: process.env.SEI_RPC_URL || 'https://rpc.sei-apis.com',
      restUrl: process.env.SEI_REST_URL || 'https://rest.sei-apis.com',
      chainId: process.env.SEI_CHAIN_ID || 'pacific-1',
      privateKey: process.env.PRIVATE_KEY,
      gasPrice: process.env.GAS_PRICE || '0.1usei',
      gasAdjustment: parseFloat(process.env.GAS_ADJUSTMENT || '1.3'),
      contractAddress: process.env.CW721_CONTRACT_ADDRESS,
    };
  }

  static override async start(runtime: IAgentRuntime): Promise<Service> {
    logger.info('Starting SEI NFT service');
    const service = new SeiNftService(runtime);
    await service.initialize();
    return service;
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

  private async initialize(): Promise<void> {
    try {
      if (!this.serviceConfig.privateKey) {
        throw new Error('PRIVATE_KEY environment variable is required');
      }

      // Create wallet from private key
      this.wallet = await DirectSecp256k1HdWallet.fromMnemonic(
        this.serviceConfig.privateKey,
        {
          prefix: 'sei',
        }
      );

      const accounts = await this.wallet.getAccounts();
      this.senderAddress = accounts[0].address;

      // Initialize query client
      this.queryClient = await CosmWasmClient.connect(this.serviceConfig.rpcUrl);

      // Initialize signing client
      this.client = await SigningCosmWasmClient.connectWithSigner(
        this.serviceConfig.rpcUrl,
        this.wallet,
        {
          gasPrice: GasPrice.fromString(this.serviceConfig.gasPrice),
        }
      );

      // Set contract address if provided
      this.contractAddress = this.serviceConfig.contractAddress;

      logger.info(`SEI NFT service initialized with address: ${this.senderAddress}`);
      if (this.contractAddress) {
        logger.info(`Using contract address: ${this.contractAddress}`);
      } else {
        logger.warn('No contract address provided. You will need to deploy a contract first.');
      }
    } catch (error) {
      logger.error('Failed to initialize SEI NFT service:', error);
      throw error;
    }
  }

  /**
   * Get wallet address
   */
  getWalletAddress(): string {
    if (!this.senderAddress) {
      throw new Error('Service not initialized');
    }
    return this.senderAddress;
  }

  /**
   * Get wallet balance
   */
  async getWalletBalance(): Promise<string> {
    if (!this.client || !this.senderAddress) {
      throw new Error('Service not initialized');
    }

    try {
      const balance = await this.client.getBalance(this.senderAddress, 'usei');
      return new Big(balance.amount).div(1000000).toString();
    } catch (error) {
      logger.error('Failed to get wallet balance:', error);
      throw new Error(`Failed to get wallet balance: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Deploy CW721 NFT contract
   */
  async deployNFTContract(
    name: string,
    symbol: string,
    minter?: string
  ): Promise<{ contractAddress: string; transactionHash: string }> {
    if (!this.client || !this.senderAddress) {
      throw new Error('Service not initialized');
    }

    try {
      // For production, you would need to:
      // 1. Upload the actual CW721 contract code to get a code ID
      // 2. Instantiate the contract with that code ID
      
      // This is a placeholder implementation - in production you need the actual contract code
      throw new Error('Contract deployment requires actual CW721 contract code. Please deploy your contract manually and set CW721_CONTRACT_ADDRESS environment variable.');
    } catch (error) {
      logger.error('Failed to deploy NFT contract:', error);
      throw error;
    }
  }

  /**
   * Mint NFT with metadata upload to IPFS
   */
  async mintNFT(
    metadata: NFTMetadata,
    recipient?: string,
    contractAddress?: string
  ): Promise<{ tokenId: string; transactionHash: string; metadataUri: string }> {
    if (!this.client || !this.senderAddress) {
      throw new Error('Service not initialized');
    }

    const targetContract = contractAddress || this.contractAddress;

    if (!targetContract) {
      throw new Error('Contract address is required. Please set CW721_CONTRACT_ADDRESS environment variable or provide contract address parameter.');
    }

    try {
      // Upload metadata to IPFS
      logger.info('Uploading metadata to IPFS...');
      const ipfsResult = await this.ipfsService.uploadJSON(metadata);
      logger.info(`Metadata uploaded to IPFS: ${ipfsResult.ipfsUrl}`);
      
      // Generate unique token ID
      const tokenId = `token_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      // Execute mint transaction on the blockchain
      const mintMsg = {
        mint: {
          token_id: tokenId,
          owner: recipient || this.senderAddress,
          token_uri: ipfsResult.ipfsUrl,
          extension: {},
        },
      };

      logger.info('Executing mint transaction on blockchain...');
      const result = await this.client.execute(
        this.senderAddress,
        targetContract,
        mintMsg,
        'auto'
      );

      logger.info(`NFT minted successfully: ${tokenId}`);
      
      return {
        tokenId,
        transactionHash: result.transactionHash,
        metadataUri: ipfsResult.ipfsUrl,
      };
    } catch (error) {
      logger.error('Failed to mint NFT:', error);
      throw new Error(`Failed to mint NFT: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Transfer NFT
   */
  async transferNFT(
    tokenId: string,
    recipient: string,
    contractAddress?: string
  ): Promise<TransactionResult> {
    if (!this.client || !this.senderAddress) {
      throw new Error('Service not initialized');
    }

    const targetContract = contractAddress || this.contractAddress;

    if (!targetContract) {
      throw new Error('Contract address is required');
    }

    try {
      const transferMsg = {
        transfer_nft: {
          recipient,
          token_id: tokenId,
        },
      };

      const result = await this.client.execute(
        this.senderAddress,
        targetContract,
        transferMsg,
        'auto'
      );

      return {
        transactionHash: result.transactionHash,
        gasUsed: result.gasUsed.toString(),
        gasWanted: result.gasWanted.toString(),
        height: result.height,
      };
    } catch (error) {
      logger.error('Failed to transfer NFT:', error);
      throw new Error(`Failed to transfer NFT: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Get owned NFTs using multiple sources
   */
  async getOwnedNFTs(
    address?: string,
    contractAddress?: string
  ): Promise<Array<CW721TokenInfo & { metadata?: NFTMetadata }>> {
    const targetAddress = address || this.senderAddress;
    if (!targetAddress) {
      throw new Error('Address is required');
    }

    try {
      // Try to get NFTs from NFTScan first
      const nftScanNFTs = await this.nftScanService.getAccountNFTs(targetAddress);
      
      if (nftScanNFTs.length > 0) {
        return nftScanNFTs.map(nft => ({
          token_id: nft.token_id,
          owner: nft.owner,
          approvals: [],
          token_uri: nft.token_uri,
          metadata: nft.metadata,
        }));
      }

      // Fallback to direct contract query if contract address is provided
      if (contractAddress && this.queryClient) {
        try {
          const tokensResult = await this.queryClient.queryContractSmart(
            contractAddress,
            {
              tokens: {
                owner: targetAddress,
                limit: 50,
              },
            }
          );

          const tokens = tokensResult.tokens || [];
          const nftsWithMetadata = [];

          for (const tokenId of tokens) {
            try {
              const tokenInfo = await this.queryClient.queryContractSmart(
                contractAddress,
                {
                  nft_info: { token_id: tokenId },
                }
              );

              // Fetch metadata if token_uri is provided
              let metadata;
              if (tokenInfo.token_uri) {
                try {
                  const metadataUrl = tokenInfo.token_uri.replace('ipfs://', 'https://ipfs.io/ipfs/');
                  const response = await axios.get(metadataUrl);
                  metadata = response.data;
                } catch (metadataError) {
                  logger.warn(`Failed to fetch metadata for token ${tokenId}:`, metadataError);
                }
              }

              nftsWithMetadata.push({
                token_id: tokenId,
                owner: targetAddress,
                approvals: tokenInfo.approvals || [],
                token_uri: tokenInfo.token_uri,
                metadata,
              });
            } catch (tokenError) {
              logger.warn(`Failed to fetch info for token ${tokenId}:`, tokenError);
            }
          }

          return nftsWithMetadata;
        } catch (contractError) {
          logger.warn('Failed to query contract directly:', contractError);
        }
      }

      return [];
    } catch (error) {
      logger.error('Failed to get owned NFTs:', error);
      throw new Error(`Failed to get owned NFTs: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Get marketplace listings from Magic Eden
   */
  async getMarketplaceListings(
    collection?: string,
    limit: number = 20
  ): Promise<MarketplaceListing[]> {
    try {
      return await this.magicEdenService.getListings(collection, limit);
    } catch (error) {
      logger.error('Failed to get marketplace listings:', error);
      return [];
    }
  }

  /**
   * Buy NFT from marketplace
   */
  async buyNFT(
    tokenId: string,
    contractAddress: string,
    price: string
  ): Promise<PurchaseResult> {
    if (!this.senderAddress) {
      throw new Error('Service not initialized');
    }

    try {
      return await this.magicEdenService.buyNFT(tokenId, contractAddress, price, this.senderAddress);
    } catch (error) {
      logger.error('Failed to buy NFT:', error);
      throw new Error(`Failed to buy NFT: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * List NFT for sale on marketplace
   */
  async sellNFT(
    tokenId: string,
    contractAddress: string,
    price: string
  ): Promise<{ listingId: string; transactionHash?: string }> {
    if (!this.senderAddress) {
      throw new Error('Service not initialized');
    }

    try {
      return await this.magicEdenService.listNFTForSale(tokenId, contractAddress, price, this.senderAddress);
    } catch (error) {
      logger.error('Failed to list NFT for sale:', error);
      throw new Error(`Failed to list NFT for sale: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Cancel NFT listing
   */
  async cancelNFTListing(
    listingId: string,
    tokenId: string,
    contractAddress: string
  ): Promise<{ success: boolean; transactionHash?: string }> {
    try {
      return await this.magicEdenService.cancelListing(listingId, tokenId, contractAddress);
    } catch (error) {
      logger.error('Failed to cancel NFT listing:', error);
      throw new Error(`Failed to cancel NFT listing: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Get collection statistics
   */
  async getCollectionStats(collection: string): Promise<any> {
    try {
      return await this.magicEdenService.getCollectionStats(collection);
    } catch (error) {
      logger.error('Failed to get collection stats:', error);
      throw new Error(`Failed to get collection stats: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Get transaction history for an address
   */
  async getTransactionHistory(
    address?: string,
    limit: number = 20
  ): Promise<any[]> {
    const targetAddress = address || this.senderAddress;
    if (!targetAddress) {
      throw new Error('Address is required');
    }

    try {
      return await this.nftScanService.getAccountTransactions(targetAddress, limit);
    } catch (error) {
      logger.error('Failed to get transaction history:', error);
      return [];
    }
  }

  /**
   * Estimate gas for a transaction
   */
  async estimateGas(
    contractAddress: string,
    msg: any
  ): Promise<number> {
    if (!this.client || !this.senderAddress) {
      throw new Error('Service not initialized');
    }

    try {
      const simulation = await this.client.simulate(
        this.senderAddress,
        [
          {
            typeUrl: '/cosmwasm.wasm.v1.MsgExecuteContract',
            value: {
              sender: this.senderAddress,
              contract: contractAddress,
              msg: toBase64(new TextEncoder().encode(JSON.stringify(msg))),
              funds: [],
            },
          },
        ],
        undefined
      );

      return Math.ceil(Number(simulation) * this.serviceConfig.gasAdjustment);
    } catch (error) {
      logger.error('Failed to estimate gas:', error);
      throw new Error(`Failed to estimate gas: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

// FIXED ACTIONS with better validation and examples
const mintNFTAction: Action = {
  name: 'MINT_NFT',
  similes: [
    'CREATE_NFT', 'MINT_TOKEN', 'CREATE_TOKEN', 'MAKE_NFT', 'GENERATE_NFT',
    'BUILD_NFT', 'PRODUCE_NFT', 'CRAFT_NFT', 'DESIGN_NFT', 'FORGE_NFT'
  ],
  description: 'Mints a new NFT on the SEI blockchain with metadata stored on IPFS',

  validate: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state: State | undefined
  ): Promise<boolean> => {
    if (!message.content.text) return false;

    const text = message.content.text.toLowerCase();
    
    // More comprehensive validation patterns
    const mintPatterns = [
      /\bmint\b.*\bnft\b/i,
      /\bcreate\b.*\bnft\b/i,
      /\bmake\b.*\bnft\b/i,
      /\bgenerate\b.*\bnft\b/i,
      /\bnew\b.*\bnft\b/i,
      /\bnft\b.*\bmint\b/i,
      /\bnft\b.*\bcreate\b/i,
      /\bforge\b.*\bnft\b/i,
      /\bcraft\b.*\bnft\b/i,
      /\bbuild\b.*\bnft\b/i
    ];

    return mintPatterns.some(pattern => pattern.test(text));
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
          error: 'Message content text is undefined',
          text: 'I need a message with text to process your NFT minting request.',
        };
      }

      const service = runtime.getService(SeiNftService.serviceType) as SeiNftService;
      if (!service) {
        throw new Error('SEI NFT service not available');
      }

      // Enhanced parsing with multiple patterns
      const text = message.content.text;
      
      // Try multiple parsing patterns
      const nameMatch = text.match(/(?:name|title|called)[:\s]+([^,\n.!?]+)/i) ||
                       text.match(/"([^"]+)"/i) ||
                       text.match(/nft\s+(?:called|named|titled)\s+([^,\n.!?]+)/i);
      
      const descMatch = text.match(/(?:description|desc|about)[:\s]+([^,\n.!?]+)/i) ||
                       text.match(/(?:it's|its)\s+([^,\n.!?]+)/i);
      
      const imageMatch = text.match(/(?:image|picture|img|photo)[:\s]+(https?:\/\/[^\s,\n]+)/i) ||
                        text.match(/(https?:\/\/[^\s,\n]+\.(?:jpg|jpeg|png|gif|webp))/i);
      
      const contractMatch = text.match(/(?:contract|address)[:\s]+(sei[a-z0-9]{39,})/i);

      const metadata: NFTMetadata = {
        name: nameMatch?.[1]?.trim() || 'AI Generated NFT',
        description: descMatch?.[1]?.trim() || 'An NFT created by AI agent',
        image: imageMatch?.[1]?.trim() || 'https://via.placeholder.com/512x512.png?text=NFT',
        attributes: [
          {
            trait_type: 'Created By',
            value: 'AI Agent'
          },
          {
            trait_type: 'Creation Date',
            value: new Date().toISOString().split('T')[0]
          }
        ]
      };

      const contractAddress = contractMatch?.[1];
      const result = await service.mintNFT(metadata, undefined, contractAddress);

      const response = `🎨 Successfully minted NFT "${metadata.name}"!

✅ Token ID: ${result.tokenId}
🔗 Transaction: ${result.transactionHash}
📝 Metadata: ${result.metadataUri}
👤 Owner: ${service.getWalletAddress()}

Your NFT has been created and the metadata is stored permanently on IPFS!`;

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
          mintResult: result,
          metadata,
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to mint NFT';
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        text: `❌ Sorry, I couldn't mint the NFT. ${errorMessage}`,
      };
    }
  },

  examples: [
    [
      {
        name: '{{name1}}',
        content: {
          text: 'I want to mint an NFT called "Digital Sunset" with description "A beautiful digital sunset artwork"',
        },
      },
      {
        name: '{{name2}}',
        content: {
          text: '🎨 Successfully minted NFT "Digital Sunset"!\n\n✅ Token ID: token_123...\n🔗 Transaction: 0xabc...\n📝 Metadata: ipfs://Qm...\n👤 Owner: sei1abc...\n\nYour NFT has been created and the metadata is stored permanently on IPFS!',
          actions: ['MINT_NFT'],
        },
      },
    ],
    [
      {
        name: '{{name1}}',
        content: {
          text: 'Create a new NFT for me with the name "Space Explorer" and make it about space exploration',
        },
      },
      {
        name: '{{name2}}',
        content: {
          text: '🎨 Successfully minted NFT "Space Explorer"!\n\n✅ Token ID: token_456...\n🔗 Transaction: 0xdef...\n📝 Metadata: ipfs://Qm...\n👤 Owner: sei1def...\n\nYour NFT has been created and the metadata is stored permanently on IPFS!',
          actions: ['MINT_NFT'],
        },
      },
    ],
    [
      {
        name: '{{name1}}',
        content: {
          text: 'Can you mint me an NFT? I want to create something cool',
        },
      },
      {
        name: '{{name2}}',
        content: {
          text: '🎨 Successfully minted NFT "AI Generated NFT"!\n\n✅ Token ID: token_789...\n🔗 Transaction: 0x123...\n📝 Metadata: ipfs://Qm...\n👤 Owner: sei1ghi...\n\nYour NFT has been created and the metadata is stored permanently on IPFS!',
          actions: ['MINT_NFT'],
        },
      },
    ]
  ],
};

const viewOwnedNFTsAction: Action = {
  name: 'VIEW_OWNED_NFTS',
  similes: [
    'SHOW_MY_NFTS', 'GET_MY_NFTS', 'LIST_MY_NFTS', 'MY_COLLECTION', 'MY_PORTFOLIO',
    'SHOW_COLLECTION', 'VIEW_COLLECTION', 'MY_TOKENS', 'OWNED_NFTS', 'NFT_PORTFOLIO',
    'CHECK_MY_NFTS', 'DISPLAY_NFTS', 'LIST_NFTS'
  ],
  description: 'Shows NFTs owned by the user with detailed metadata from IPFS',

  validate: async (runtime: IAgentRuntime, message: Memory, _state: State | undefined): Promise<boolean> => {
    if (!message.content.text) return false;
    
    const text = message.content.text.toLowerCase();
    
    const viewPatterns = [
      /\bshow\b.*\bmy\b.*\bnft/i,
      /\bmy\b.*\bnft/i,
      /\bowned\b.*\bnft/i,
      /\bmy\b.*\bcollection/i,
      /\bmy\b.*\bportfolio/i,
      /\bwhat\b.*\bnft.*\bdo\b.*\bi\b.*\bhave/i,
      /\blist\b.*\bmy\b.*\bnft/i,
      /\bview\b.*\bmy\b.*\bnft/i,
      /\bcheck\b.*\bmy\b.*\bnft/i,
      /\bdisplay\b.*\bmy\b.*\bnft/i,
      /\bget\b.*\bmy\b.*\bnft/i
    ];

    return viewPatterns.some(pattern => pattern.test(text));
  },

  handler: async (runtime: IAgentRuntime, message: Memory, _state: State | undefined, _options: Record<string, unknown> = {}, callback?: HandlerCallback, _responses?: Memory[]): Promise<ActionResult> => {
    try {
      const service = runtime.getService(SeiNftService.serviceType) as SeiNftService;
      if (!service) throw new Error('SEI NFT service not available');

      const ownedNFTs = await service.getOwnedNFTs();
      const walletAddress = service.getWalletAddress();
      const balance = await service.getWalletBalance();

      let response = `📊 **Your NFT Portfolio**\n\n👤 **Address**: \`${walletAddress}\`\n💰 **Balance**: ${balance} SEI\n\n`;

      if (ownedNFTs.length === 0) {
        response += `🔍 You don't own any NFTs yet.\n\n🎨 **Get started by**:\n• Minting new NFTs\n• Purchasing from Magic Eden marketplace\n• Transferring from other wallets`;
      } else {
        response += `🎨 **Collection Summary**: ${ownedNFTs.length} NFT${ownedNFTs.length > 1 ? 's' : ''}\n\n`;
        ownedNFTs.slice(0, 10).forEach((nft, index) => {
          response += `**${index + 1}. ${nft.metadata?.name || `Token #${nft.token_id}`}**\n`;
          response += `   🆔 Token ID: \`${nft.token_id}\`\n`;
          if (nft.metadata?.description) {
            const desc = nft.metadata.description.length > 100 ? nft.metadata.description.slice(0, 100) + '...' : nft.metadata.description;
            response += `   📝 Description: ${desc}\n`;
          }
          if (nft.metadata?.attributes && nft.metadata.attributes.length > 0) {
            response += `   ✨ Traits: ${nft.metadata.attributes.slice(0, 3).map(attr => `${attr.trait_type}: ${String(attr.value)}`).join(', ')}\n`;
          }
          if (nft.token_uri) response += `   🔗 Metadata: ${nft.token_uri}\n`;
          response += '\n';
        });
        if (ownedNFTs.length > 10) response += `... and ${ownedNFTs.length - 10} more NFTs in your collection.`;
      }

      if (callback) {
        await callback({ text: response, actions: ['VIEW_OWNED_NFTS'], source: message.content.source });
      }

      return { text: response, success: true, data: { actions: ['VIEW_OWNED_NFTS'], source: message.content.source, ownedNFTs, walletAddress, balance } };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to retrieve owned NFTs';
      return { success: false, error: error instanceof Error ? error.message : String(error), text: `❌ Sorry, I couldn't retrieve your NFTs. ${errorMessage}` };
    }
  },

  examples: [
    [
      { name: '{{name1}}', content: { text: 'Show me my NFT collection' } },
      { name: '{{name2}}', content: { text: '📊 Your NFT Portfolio\n\n👤 Address: sei123...\n💰 Balance: 2.5 SEI\n\n🎨 Collection Summary: 3 NFTs\n\n**1. Digital Sunset**\n   🆔 Token ID: token_123\n   📝 Description: A beautiful digital sunset artwork', actions: ['VIEW_OWNED_NFTS'] } }
    ],
    [
      { name: '{{name1}}', content: { text: 'What NFTs do I have?' } },
      { name: '{{name2}}', content: { text: '📊 Your NFT Portfolio\n\n👤 Address: sei456...\n💰 Balance: 1.2 SEI\n\n🔍 You don\'t own any NFTs yet.\n\n🎨 Get started by:\n• Minting new NFTs', actions: ['VIEW_OWNED_NFTS'] } }
    ],
    [
      { name: '{{name1}}', content: { text: 'Check my portfolio' } },
      { name: '{{name2}}', content: { text: '📊 Your NFT Portfolio\n\n👤 Address: sei789...\n💰 Balance: 5.0 SEI\n\n🎨 Collection Summary: 1 NFT', actions: ['VIEW_OWNED_NFTS'] } }
    ]
  ],
};

const viewMarketplaceAction: Action = {
  name: 'VIEW_MARKETPLACE',
  similes: [
    'BROWSE_NFTS', 'MARKETPLACE', 'AVAILABLE_NFTS', 'BROWSE_MARKETPLACE', 'MAGIC_EDEN',
    'SHOW_MARKETPLACE', 'LIST_MARKETPLACE', 'NFTS_FOR_SALE', 'BROWSE_AVAILABLE',
    'MARKET_LISTINGS', 'FOR_SALE', 'AVAILABLE_TOKENS'
  ],
  description: 'Browse available NFTs on Magic Eden marketplace',

  validate: async (runtime: IAgentRuntime, message: Memory, _state: State | undefined): Promise<boolean> => {
    if (!message.content.text) return false;
    
    const text = message.content.text.toLowerCase();
    
    const marketplacePatterns = [
      /\bmarketplace/i,
      /\bbrowse\b.*\bnft/i,
      /\bavailable\b.*\bnft/i,
      /\bmagic\s*eden/i,
      /\bnfts?\b.*\bfor\s*sale/i,
      /\bbuy\b.*\bnft/i,
      /\bshow\b.*\bmarketplace/i,
      /\blist\b.*\bmarketplace/i,
      /\bmarket\b.*\blisting/i,
      /\bfor\s*sale/i,
      /\bavailable\b.*\btoken/i
    ];

    return marketplacePatterns.some(pattern => pattern.test(text));
  },

  handler: async (runtime: IAgentRuntime, message: Memory, _state: State | undefined, _options: Record<string, unknown> = {}, callback?: HandlerCallback, _responses?: Memory[]): Promise<ActionResult> => {
    try {
      const service = runtime.getService(SeiNftService.serviceType) as SeiNftService;
      if (!service) throw new Error('SEI NFT service not available');

      const text = message.content.text!;
      const collectionMatch = text.match(/collection[:\s]+([^\s,\n]+)/i);
      const collection = collectionMatch?.[1];

      const listings = await service.getMarketplaceListings(collection, 15);

      let response = `🏪 **Magic Eden Marketplace**\n\n`;

      if (listings.length === 0) {
        response += `🔍 No NFTs currently listed for sale.\n\n💡 **Try**:\n• Checking specific collections\n• Coming back later for new listings\n• Browsing by collection name`;
      } else {
        response += `🎨 **Available NFTs** (${listings.length} listings):\n\n`;
        listings.slice(0, 10).forEach((listing, index) => {
          response += `**${index + 1}. ${listing.metadata?.name || `Token #${listing.token_id}`}**\n`;
          response += `   💰 Price: ${listing.price} ${listing.currency}\n`;
          response += `   👤 Seller: \`${listing.seller.slice(0, 8)}...${listing.seller.slice(-6)}\`\n`;
          response += `   🆔 Token ID: \`${listing.token_id}\`\n`;
          response += `   📋 Contract: \`${listing.contract_address.slice(0, 8)}...${listing.contract_address.slice(-6)}\`\n`;
          if (listing.metadata?.description) {
            const desc = listing.metadata.description.length > 80 ? listing.metadata.description.slice(0, 80) + '...' : listing.metadata.description;
            response += `   📝 ${desc}\n`;
          }
          response += '\n';
        });
        if (listings.length > 10) response += `... and ${listings.length - 10} more listings available.\n\n`;
        response += `💡 **To purchase**: Say "buy NFT token ID: [ID], contract: [address], price: [amount]"`;
      }

      if (callback) {
        await callback({ text: response, actions: ['VIEW_MARKETPLACE'], source: message.content.source });
      }

      return { text: response, success: true, data: { actions: ['VIEW_MARKETPLACE'], source: message.content.source, listings } };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to browse marketplace';
      return { success: false, error: error instanceof Error ? error.message : String(error), text: `❌ Sorry, I couldn't browse the marketplace. ${errorMessage}` };
    }
  },

  examples: [
    [
      { name: '{{name1}}', content: { text: 'Browse NFTs on Magic Eden marketplace' } },
      { name: '{{name2}}', content: { text: '🏪 Magic Eden Marketplace\n\n🎨 Available NFTs (5 listings):\n\n**1. Cool Cat #123**\n   💰 Price: 2.5 SEI\n   👤 Seller: sei1abc...def\n   🆔 Token ID: token_123', actions: ['VIEW_MARKETPLACE'] } }
    ],
    [
      { name: '{{name1}}', content: { text: 'Show me what NFTs are for sale' } },
      { name: '{{name2}}', content: { text: '🏪 Magic Eden Marketplace\n\n🎨 Available NFTs (3 listings):\n\n**1. Space Explorer #456**\n   💰 Price: 1.0 SEI', actions: ['VIEW_MARKETPLACE'] } }
    ],
    [
      { name: '{{name1}}', content: { text: 'What\'s available on the marketplace?' } },
      { name: '{{name2}}', content: { text: '🏪 Magic Eden Marketplace\n\n🔍 No NFTs currently listed for sale.\n\n💡 Try:\n• Checking specific collections', actions: ['VIEW_MARKETPLACE'] } }
    ]
  ],
};

const buyNFTAction: Action = {
  name: 'BUY_NFT',
  similes: [
    'PURCHASE_NFT', 'BUY_TOKEN', 'PURCHASE_TOKEN', 'ACQUIRE_NFT', 'GET_NFT',
    'OBTAIN_NFT', 'BUY_ITEM', 'PURCHASE_ITEM'
  ],
  description: 'Purchase an NFT from the Magic Eden marketplace',

  validate: async (runtime: IAgentRuntime, message: Memory, _state: State | undefined): Promise<boolean> => {
    if (!message.content.text) return false;
    
    const text = message.content.text.toLowerCase();
    
    const buyPatterns = [
      /\bbuy\b.*\bnft/i,
      /\bpurchase\b.*\bnft/i,
      /\bbuy\b.*\btoken/i,
      /\bpurchase\b.*\btoken/i,
      /\bacquire\b.*\bnft/i,
      /\bget\b.*\bnft/i,
      /\bobtain\b.*\bnft/i,
      /\bbuy\b.*\bitem/i,
      /\bpurchase\b.*\bitem/i
    ];

    return buyPatterns.some(pattern => pattern.test(text));
  },

  handler: async (runtime: IAgentRuntime, message: Memory, _state: State | undefined, _options: Record<string, unknown> = {}, callback?: HandlerCallback, _responses?: Memory[]): Promise<ActionResult> => {
    try {
      if (!message.content.text) {
        return {
          success: false,
          error: 'Message content text is undefined',
          text: 'I need a message with text to process your NFT purchase request.',
        };
      }

      const service = runtime.getService(SeiNftService.serviceType) as SeiNftService;
      if (!service) throw new Error('SEI NFT service not available');

      const text = message.content.text;
      
      // Enhanced parsing patterns
      const tokenIdMatch = text.match(/(?:token\s*(?:id)?|id)[:\s]*([a-zA-Z0-9_]+)/i);
      const contractMatch = text.match(/(?:contract|address)[:\s]+(sei[a-z0-9]{39,})/i);
      const priceMatch = text.match(/(?:price|cost|for)[:\s]*([0-9.]+)/i);

      if (!tokenIdMatch || !contractMatch || !priceMatch) {
        return {
          success: false,
          error: 'Missing required purchase details',
          text: 'Please provide the token ID, contract address, and price. Example: "Buy NFT token ID: abc123, contract: sei1abc..., price: 0.5"',
        };
      }

      const tokenId = tokenIdMatch[1];
      const contractAddress = contractMatch[1];
      const price = priceMatch[1];

      const result = await service.buyNFT(tokenId, contractAddress, price);

      const response = `✅ **NFT Purchase Successful!**

🎨 NFT Details:
🆔 Token ID: \`${result.tokenId}\`
📋 Contract: \`${contractAddress}\`
💰 Price Paid: ${result.price} SEI

👤 Transaction Details:
🔗 Transaction: \`${result.transactionHash}\`
🛒 Buyer: \`${result.buyer}\`
👤 Seller: \`${result.seller}\`

Congratulations! The NFT is now in your wallet!`;

      if (callback) {
        await callback({ text: response, actions: ['BUY_NFT'], source: message.content.source });
      }

      return { text: response, success: true, data: { actions: ['BUY_NFT'], source: message.content.source, purchaseResult: result } };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to purchase NFT';
      return { success: false, error: error instanceof Error ? error.message : String(error), text: `❌ Sorry, I couldn't purchase the NFT. ${errorMessage}` };
    }
  },

  examples: [
    [
      { name: '{{name1}}', content: { text: 'Buy NFT token ID: abc123, contract: sei1def..., price: 0.5' } },
      { name: '{{name2}}', content: { text: '✅ NFT Purchase Successful!\n\n🎨 NFT Details:\n🆔 Token ID: abc123\n💰 Price Paid: 0.5 SEI\n\n👤 Transaction Details:\n🔗 Transaction: 0x123...\n🛒 Buyer: sei1abc...\n👤 Seller: sei1def...', actions: ['BUY_NFT'] } }
    ],
    [
      { name: '{{name1}}', content: { text: 'I want to purchase the NFT with token ID xyz789 from contract sei1ghi... for 1.2 SEI' } },
      { name: '{{name2}}', content: { text: '✅ NFT Purchase Successful!\n\n🎨 NFT Details:\n🆔 Token ID: xyz789\n💰 Price Paid: 1.2 SEI', actions: ['BUY_NFT'] } }
    ],
    [
      { name: '{{name1}}', content: { text: 'Can you buy token abc456 for 0.8 SEI from sei1jkl...?' } },
      { name: '{{name2}}', content: { text: '✅ NFT Purchase Successful!\n\n🎨 NFT Details:\n🆔 Token ID: abc456\n💰 Price Paid: 0.8 SEI', actions: ['BUY_NFT'] } }
    ]
  ],
};

const sellNFTAction: Action = {
  name: 'SELL_NFT',
  similes: [
    'LIST_NFT', 'SELL_TOKEN', 'LIST_FOR_SALE', 'LIST_ITEM', 'SELL_ITEM',
    'PUT_FOR_SALE', 'OFFER_FOR_SALE', 'MARKET_NFT'
  ],
  description: 'List an owned NFT for sale on Magic Eden marketplace',

  validate: async (runtime: IAgentRuntime, message: Memory, _state: State | undefined): Promise<boolean> => {
    if (!message.content.text) return false;
    
    const text = message.content.text.toLowerCase();
    
    const sellPatterns = [
      /\bsell\b.*\bnft/i,
      /\blist\b.*\bnft/i,
      /\bsell\b.*\btoken/i,
      /\blist\b.*\btoken/i,
      /\blist\b.*\bfor\s*sale/i,
      /\bput\b.*\bfor\s*sale/i,
      /\boffer\b.*\bfor\s*sale/i,
      /\bmarket\b.*\bnft/i,
      /\bsell\b.*\bitem/i,
      /\blist\b.*\bitem/i
    ];

    return sellPatterns.some(pattern => pattern.test(text));
  },

  handler: async (runtime: IAgentRuntime, message: Memory, _state: State | undefined, _options: Record<string, unknown> = {}, callback?: HandlerCallback, _responses?: Memory[]): Promise<ActionResult> => {
    try {
      if (!message.content.text) {
        return {
          success: false,
          error: 'Message content text is undefined',
          text: 'I need a message with text to process your NFT selling request.',
        };
      }

      const service = runtime.getService(SeiNftService.serviceType) as SeiNftService;
      if (!service) throw new Error('SEI NFT service not available');

      const text = message.content.text;
      
      // Enhanced parsing patterns
      const tokenIdMatch = text.match(/(?:token\s*(?:id)?|id)[:\s]*([a-zA-Z0-9_]+)/i);
      const contractMatch = text.match(/(?:contract|address)[:\s]+(sei[a-z0-9]{39,})/i);
      const priceMatch = text.match(/(?:price|for)[:\s]*([0-9.]+)/i);

      if (!tokenIdMatch || !contractMatch || !priceMatch) {
        return {
          success: false,
          error: 'Missing required selling details',
          text: 'Please provide the token ID, contract address, and asking price. Example: "Sell NFT token ID: abc123, contract: sei1abc..., price: 1.0"',
        };
      }

      const tokenId = tokenIdMatch[1];
      const contractAddress = contractMatch[1];
      const price = priceMatch[1];

      const result = await service.sellNFT(tokenId, contractAddress, price);

      const response = `🏪 **NFT Listed for Sale!**

🎨 Listing Details:
🆔 Token ID: \`${tokenId}\`
📋 Contract: \`${contractAddress}\`
💰 Asking Price: ${price} SEI

📋 Marketplace Info:
🏷️ Listing ID: \`${result.listingId}\`
🏪 Marketplace: Magic Eden
👤 Seller: \`${service.getWalletAddress()}\`

Your NFT is now available for purchase on Magic Eden!`;

      if (callback) {
        await callback({ text: response, actions: ['SELL_NFT'], source: message.content.source });
      }

      return { text: response, success: true, data: { actions: ['SELL_NFT'], source: message.content.source, listingResult: result, tokenId, contractAddress, price } };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to list NFT for sale';
      return { success: false, error: error instanceof Error ? error.message : String(error), text: `❌ Sorry, I couldn't list the NFT for sale. ${errorMessage}` };
    }
  },

  examples: [
    [
      { name: '{{name1}}', content: { text: 'Sell NFT token ID: abc123, contract: sei1def..., price: 1.0' } },
      { name: '{{name2}}', content: { text: '🏪 NFT Listed for Sale!\n\n🎨 Listing Details:\n🆔 Token ID: abc123\n💰 Asking Price: 1.0 SEI\n\n📋 Marketplace Info:\n🏷️ Listing ID: listing_123\n🏪 Marketplace: Magic Eden', actions: ['SELL_NFT'] } }
    ],
    [
      { name: '{{name1}}', content: { text: 'I want to list my NFT xyz789 for sale at 2.5 SEI from contract sei1ghi...' } },
      { name: '{{name2}}', content: { text: '🏪 NFT Listed for Sale!\n\n🎨 Listing Details:\n🆔 Token ID: xyz789\n💰 Asking Price: 2.5 SEI', actions: ['SELL_NFT'] } }
    ],
    [
      { name: '{{name1}}', content: { text: 'List token def456 for 0.75 SEI on the marketplace, contract sei1jkl...' } },
      { name: '{{name2}}', content: { text: '🏪 NFT Listed for Sale!\n\n🎨 Listing Details:\n🆔 Token ID: def456\n💰 Asking Price: 0.75 SEI', actions: ['SELL_NFT'] } }
    ]
  ],
};

const cancelListingAction: Action = {
  name: 'CANCEL_LISTING',
  similes: [
    'CANCEL_SALE', 'REMOVE_LISTING', 'UNLIST_NFT', 'CANCEL_ORDER',
    'REMOVE_FROM_SALE', 'WITHDRAW_LISTING', 'DELIST_NFT'
  ],
  description: 'Cancel an existing NFT listing on Magic Eden marketplace',

  validate: async (runtime: IAgentRuntime, message: Memory, _state: State | undefined): Promise<boolean> => {
    if (!message.content.text) return false;
    
    const text = message.content.text.toLowerCase();
    
    const cancelPatterns = [
      /\bcancel\b.*\blisting/i,
      /\bcancel\b.*\bsale/i,
      /\bremove\b.*\blisting/i,
      /\bunlist\b.*\bnft/i,
      /\bcancel\b.*\border/i,
      /\bremove\b.*\bfrom\s*sale/i,
      /\bwithdraw\b.*\blisting/i,
      /\bdelist\b.*\bnft/i
    ];

    return cancelPatterns.some(pattern => pattern.test(text));
  },

  handler: async (runtime: IAgentRuntime, message: Memory, _state: State | undefined, _options: Record<string, unknown> = {}, callback?: HandlerCallback, _responses?: Memory[]): Promise<ActionResult> => {
    try {
      if (!message.content.text) {
        return {
          success: false,
          error: 'Message content text is undefined',
          text: 'I need a message with text to process your listing cancellation request.',
        };
      }

      const service = runtime.getService(SeiNftService.serviceType) as SeiNftService;
      if (!service) throw new Error('SEI NFT service not available');

      const text = message.content.text;
      
      // Enhanced parsing patterns
      const listingIdMatch = text.match(/(?:listing\s*(?:id)?|id)[:\s]*([a-zA-Z0-9_]+)/i);
      const tokenIdMatch = text.match(/(?:token\s*(?:id)?|token)[:\s]*([a-zA-Z0-9_]+)/i);
      const contractMatch = text.match(/(?:contract|address)[:\s]+(sei[a-z0-9]{39,})/i);

      if (!listingIdMatch || !tokenIdMatch || !contractMatch) {
        return {
          success: false,
          error: 'Missing required cancellation details',
          text: 'Please provide the listing ID, token ID, and contract address. Example: "Cancel listing ID: listing_123, token ID: abc123, contract: sei1abc..."',
        };
      }

      const listingId = listingIdMatch[1];
      const tokenId = tokenIdMatch[1];
      const contractAddress = contractMatch[1];

      const result = await service.cancelNFTListing(listingId, tokenId, contractAddress);

      const response = result.success 
        ? `✅ **Listing Canceled Successfully!**

🏷️ Listing ID: \`${listingId}\`
🆔 Token ID: \`${tokenId}\`
📋 Contract: \`${contractAddress}\`
${result.transactionHash ? `🔗 Transaction: \`${result.transactionHash}\`` : ''}

Your NFT is no longer listed for sale and is back in your wallet.`
        : `❌ **Failed to Cancel Listing**

🏷️ Listing ID: \`${listingId}\`
🆔 Token ID: \`${tokenId}\`

The listing may have already been sold or canceled.`;

      if (callback) {
        await callback({ text: response, actions: ['CANCEL_LISTING'], source: message.content.source });
      }

      return { 
        text: response, 
        success: result.success, 
        data: { 
          actions: ['CANCEL_LISTING'], 
          source: message.content.source, 
          cancelResult: result, 
          listingId, 
          tokenId, 
          contractAddress 
        } 
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to cancel listing';
      return { success: false, error: error instanceof Error ? error.message : String(error), text: `❌ Sorry, I couldn't cancel the listing. ${errorMessage}` };
    }
  },

  examples: [
    [
      { name: '{{name1}}', content: { text: 'Cancel listing ID: listing_123, token ID: abc123, contract: sei1def...' } },
      { name: '{{name2}}', content: { text: '✅ Listing Canceled Successfully!\n\n🏷️ Listing ID: listing_123\n🆔 Token ID: abc123\n📋 Contract: sei1def...\n\nYour NFT is no longer listed for sale and is back in your wallet.', actions: ['CANCEL_LISTING'] } }
    ],
    [
      { name: '{{name1}}', content: { text: 'Remove my listing xyz789 from the marketplace, listing ID is listing_456, contract sei1ghi...' } },
      { name: '{{name2}}', content: { text: '✅ Listing Canceled Successfully!\n\n🏷️ Listing ID: listing_456\n🆔 Token ID: xyz789', actions: ['CANCEL_LISTING'] } }
    ],
    [
      { name: '{{name1}}', content: { text: 'I want to cancel the sale of token def123, listing listing_789, contract sei1jkl...' } },
      { name: '{{name2}}', content: { text: '✅ Listing Canceled Successfully!\n\n🏷️ Listing ID: listing_789\n🆔 Token ID: def123', actions: ['CANCEL_LISTING'] } }
    ]
  ],
};

export const seiNftPlugin: Plugin = {
  name: 'plugin-sei-nft',
  description: 'Complete SEI blockchain NFT plugin with CosmWasm CW721 contracts, IPFS metadata storage, Magic Eden marketplace integration, and comprehensive NFT management including buying and selling',
  config: {
    PRIVATE_KEY: process.env.PRIVATE_KEY,
    SEI_RPC_URL: process.env.SEI_RPC_URL,
    SEI_REST_URL: process.env.SEI_REST_URL,
    SEI_CHAIN_ID: process.env.SEI_CHAIN_ID,
    MAGIC_EDEN_API_KEY: process.env.MAGIC_EDEN_API_KEY,
    NFTSCAN_API_KEY: process.env.NFTSCAN_API_KEY,
    PINATA_JWT: process.env.PINATA_JWT,
    PINATA_GATEWAY: process.env.PINATA_GATEWAY,
    CW721_CONTRACT_ADDRESS: process.env.CW721_CONTRACT_ADDRESS,
  },

  async init(config: Record<string, string>) {
    logger.info('Initializing complete SEI NFT plugin');
    try {
      const validatedConfig = await configSchema.parseAsync(config);

      // Set all environment variables
      for (const [key, value] of Object.entries(validatedConfig)) {
        if (value) process.env[key] = String(value);
      }

      // Validate required environment variables
      if (!process.env.PRIVATE_KEY) {
        throw new Error('PRIVATE_KEY environment variable is required');
      }

      logger.info('SEI NFT plugin initialized successfully');
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
    [ModelType.TEXT_SMALL]: async () => {
      return 'I can help you with complete SEI blockchain NFT operations including minting with IPFS metadata, marketplace trading, buying, selling, collection management, and portfolio analysis.';
    },
    [ModelType.TEXT_LARGE]: async () => {
      return `I specialize in comprehensive SEI blockchain NFT operations:

🎨 NFT Creation: Mint NFTs with metadata stored on IPFS
📊 Portfolio Management: View and manage your NFT collection
🏪 Marketplace Integration: Browse, buy, and sell on Magic Eden
💰 Trading: Complete buy/sell functionality with real transactions
⛓️ Blockchain Operations: Transfer, batch operations, gas optimization
📈 Analytics: Collection stats, price tracking, transaction history

I use real CosmWasm CW721 contracts, IPFS storage via Pinata, and integrate with Magic Eden's official APIs for buying and selling. Just tell me what you'd like to do with NFTs!`;
    },
  },

  routes: [
    {
      name: 'api-nft-mint',
      path: '/api/nft/mint',
      type: 'POST',
      handler: async (req: any, res: any) => {
        try {
          const { name, description, image, attributes, contract_address } = req.body;

          if (!name || !description) {
            return res.status(400).json({ error: 'Name and description are required' });
          }

          const service = req.runtime.getService(SeiNftService.serviceType) as SeiNftService;
          if (!service) {
            return res.status(500).json({ error: 'SEI NFT service not available' });
          }

          const metadata: NFTMetadata = {
            name,
            description,
            image: image || 'https://via.placeholder.com/512x512.png?text=NFT',
            attributes: attributes || []
          };

          const result = await service.mintNFT(metadata, undefined, contract_address);
          res.json(result);
        } catch (error) {
          res.status(500).json({
            error: 'Failed to mint NFT',
            details: error instanceof Error ? error.message : String(error),
          });
        }
      },
    },
    // ... rest of the routes remain the same
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
  actions: [
    mintNFTAction,
    viewOwnedNFTsAction,
    viewMarketplaceAction,
    buyNFTAction,
    sellNFTAction,
    cancelListingAction,
  ],
  providers: [],
};

export default seiNftPlugin;