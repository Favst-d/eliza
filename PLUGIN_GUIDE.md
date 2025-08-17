# Eliza OS Plugin Development Guide

This guide explains how to create plugins for Eliza OS based on the patterns demonstrated in the SEI notification plugin.

## Plugin Architecture Overview

An Eliza OS plugin consists of several key components:

1. **Configuration Schema** - Validates environment variables and settings
2. **Service Classes** - Background services that run continuously
3. **Actions** - Handle user interactions and commands
4. **Plugin Export** - Main configuration object that ties everything together

## Key Components Breakdown

### 1. Configuration Schema (Zod Validation)

```typescript
const configSchema = z.object({
  API_KEY: z.string().min(1, 'API key is required'),
  TELEGRAM_BOT_TOKEN: z.string().min(1, 'Telegram bot token is required'),
  TELEGRAM_CHAT_ID: z.string().min(1, 'Telegram chat ID is required'),
  CHECK_INTERVAL: z.number().default(60000), // Default 1 minute
});
```

**Purpose**: Validates configuration and provides type safety for environment variables.

**Best Practices**:
- Use descriptive error messages
- Provide sensible defaults for optional values
- Transform values when needed (e.g., string URLs to trimmed strings)

### 2. Service Classes

Services extend the base `Service` class and provide background functionality:

```typescript
export class MyService extends Service {
  static override serviceType = 'my-service';
  
  override capabilityDescription = 'Describes what this service does';

  // Static lifecycle methods
  static override async start(runtime: IAgentRuntime): Promise<Service> {
    const service = new MyService(runtime);
    await service.initialize();
    return service;
  }

  static override async stop(runtime: IAgentRuntime): Promise<void> {
    const service = runtime.getService(MyService.serviceType) as MyService;
    await service.stop();
  }

  // Instance methods
  override async stop(): Promise<void> {
    // Cleanup timers, connections, etc.
  }

  async initialize(): Promise<void> {
    // Setup monitoring, timers, etc.
  }
}
```

**Key Patterns**:
- **Static serviceType**: Unique identifier for the service
- **Lifecycle Management**: `start()` and `stop()` methods for proper initialization/cleanup
- **Timer Management**: Use `setInterval()` for periodic tasks, clear them in `stop()`
- **Error Handling**: Wrap async operations in try-catch blocks with proper logging

### 3. Actions

Actions handle user interactions and define how the bot responds to specific messages:

```typescript
const myAction: Action = {
  name: 'MY_ACTION',
  similes: ['SIMILAR_ACTION', 'ANOTHER_NAME'], // Alternative names
  description: 'What this action does',

  validate: async (runtime, message, state) => {
    // Return true if this action should handle the message
    if (!message.content.text) return false;
    
    const text = message.content.text.toLowerCase();
    return text.includes('trigger-word');
  },

  handler: async (runtime, message, state, options, callback, responses) => {
    try {
      // Process the message and perform the action
      const result = await doSomething();
      
      const response = `✅ Success! ${result}`;
      
      if (callback) {
        await callback({
          text: response,
          actions: ['MY_ACTION'],
          source: message.content.source,
        });
      }

      return {
        text: response,
        success: true,
        data: { /* any additional data */ },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
        text: `Sorry, something went wrong: ${error.message}`,
      };
    }
  },

  examples: [
    [
      { name: '{{name1}}', content: { text: 'User input example' } },
      { name: '{{name2}}', content: { text: 'Bot response example', actions: ['MY_ACTION'] } },
    ],
  ],
};
```

**Key Patterns**:
- **Validation**: Check if the message should trigger this action
- **Error Handling**: Always return proper error responses
- **Callbacks**: Use callback for immediate responses
- **Examples**: Provide training examples for the AI

### 4. Plugin Export

The main plugin configuration ties everything together:

```typescript
export const myPlugin: Plugin = {
  name: 'plugin-my-name',
  description: 'What this plugin does',
  
  config: {
    // Map environment variables
    API_KEY: process.env.API_KEY,
    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
    // ... other config
  },
  
  async init(config: Record<string, string>) {
    // Validate configuration
    const validatedConfig = await configSchema.parseAsync(config);
    
    // Set environment variables
    for (const [key, value] of Object.entries(validatedConfig)) {
      if (value) process.env[key] = String(value);
    }
  },

  models: {
    [ModelType.TEXT_SMALL]: async (runtime, params) => {
      return 'Short response about what this plugin does';
    },
    [ModelType.TEXT_LARGE]: async (runtime, params) => {
      return 'Detailed response about plugin capabilities';
    },
  },

  routes: [
    {
      name: 'api-endpoint-name',
      path: '/api/my-plugin/endpoint',
      type: 'GET',
      handler: async (req, res) => {
        // Handle HTTP requests
      },
    },
  ],

  events: {
    [EventType.MESSAGE_RECEIVED]: [
      async (params: MessagePayload) => {
        // Handle events
      },
    ],
  },

  services: [MyService],
  actions: [myAction],
  providers: [], // For LLM providers
};
```

## Common Patterns and Best Practices

### 1. Telegram Integration

For sending Telegram messages:

```typescript
private escapeMarkdownV2(text: string): string {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, '\\$&');
}

private validateChatId(chatId: string): string {
  if (/^-?\d+$/.test(chatId)) return chatId;
  if (chatId.startsWith('@')) return chatId;
  throw new Error(`Invalid chat_id format: "${chatId}"`);
}

async sendTelegramMessage(message: string, chatId?: string): Promise<void> {
  const validChatId = this.validateChatId(chatId || this.telegramChatId);
  const escapedMessage = this.escapeMarkdownV2(message);
  
  try {
    await axios.post(`https://api.telegram.org/bot${this.telegramBotToken}/sendMessage`, {
      chat_id: validChatId,
      text: escapedMessage,
      parse_mode: 'MarkdownV2',
    });
  } catch (error) {
    // Fallback to plain text if markdown fails
    if (error.response?.status === 400) {
      await this.sendPlainTelegramMessage(message, chatId);
    }
    throw error;
  }
}
```

### 2. External API Integration

```typescript
async fetchExternalData(params: any): Promise<DataType> {
  try {
    const response = await axios.get('https://api.example.com/data', {
      params,
      headers: { 'Authorization': `Bearer ${this.apiKey}` },
      timeout: 10000,
    });

    if (response.status !== 200) {
      throw new Error(`API returned status ${response.status}`);
    }

    return response.data;
  } catch (error) {
    logger.error({ error, params }, 'Failed to fetch external data');
    throw new Error(`API request failed: ${error.message}`);
  }
}
```

### 3. Periodic Monitoring

```typescript
private startMonitoring(): void {
  this.monitoringTimer = setInterval(async () => {
    try {
      const data = await this.fetchData();
      await this.processData(data);
    } catch (error) {
      logger.error({ error }, 'Error during monitoring');
    }
  }, this.checkInterval);
}
```

### 4. Message Parsing

```typescript
private parseUserMessage(text: string): ParsedData {
  const lowerText = text.toLowerCase();
  
  // Extract numeric values
  const numberMatch = text.match(/(\d+\.?\d*)/);
  const number = numberMatch ? parseFloat(numberMatch[1]) : null;
  
  // Extract city/location
  const locationMatch = text.match(/in ([a-zA-Z\s]+)/);
  const location = locationMatch ? locationMatch[1].trim() : 'default';
  
  // Determine condition
  const condition = lowerText.includes('above') ? 'above' : 
                   lowerText.includes('below') ? 'below' : 'equal';
  
  return { number, location, condition };
}
```

## Environment Variables Setup

Create a `.env` file with required variables:

```bash
# API Keys
OPENWEATHER_API_KEY=your_api_key_here
COINMARKETCAP_API_KEY=your_cmc_key_here

# Telegram Configuration
TELEGRAM_BOT_TOKEN=your_bot_token_here
TELEGRAM_CHAT_ID=your_chat_id_here

# Intervals (in milliseconds)
PRICE_CHECK_INTERVAL=60000
WEATHER_CHECK_INTERVAL=300000
```

## Plugin Registration

To use your plugin in an Eliza agent:

```typescript
import { weatherPlugin } from './plugins/weather-plugin';

const agent = new Agent({
  plugins: [weatherPlugin],
  // ... other configuration
});
```

## Testing Your Plugin

1. **Unit Tests**: Test individual methods and functions
2. **Integration Tests**: Test API interactions
3. **Manual Testing**: Use the plugin in a running agent
4. **Error Scenarios**: Test with invalid inputs and API failures

## Common Gotchas

1. **Memory Leaks**: Always clear timers in `stop()` methods
2. **Error Handling**: Wrap all async operations in try-catch
3. **Rate Limiting**: Respect API rate limits with appropriate delays
4. **Markdown Escaping**: Properly escape special characters for Telegram
5. **Configuration Validation**: Always validate config before using
6. **Logging**: Use structured logging with context

## Example Use Cases

- **Price Monitoring**: Track cryptocurrency or stock prices
- **Weather Alerts**: Monitor weather conditions
- **News Monitoring**: Track specific topics or keywords
- **System Monitoring**: Monitor server health or application metrics
- **Social Media**: Track mentions or hashtags
- **Calendar Integration**: Remind about upcoming events

This architecture provides a robust foundation for creating powerful, maintainable plugins for Eliza OS agents.