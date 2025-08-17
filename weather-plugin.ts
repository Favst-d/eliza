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

/**
 * Defines the configuration schema for the weather plugin
 */
const configSchema = z.object({
  OPENWEATHER_API_KEY: z.string().min(1, 'OpenWeather API key is required'),
  TELEGRAM_BOT_TOKEN: z.string().min(1, 'Telegram bot token is required'),
  TELEGRAM_CHAT_ID: z.string().min(1, 'Telegram chat ID is required'),
  WEATHER_CHECK_INTERVAL: z.number().default(300000), // 5 minutes
  ALERT_CHECK_INTERVAL: z.number().default(600000), // 10 minutes
});

/**
 * Interface for weather alert data
 */
interface WeatherAlert {
  id: string;
  city: string;
  condition: 'rain' | 'snow' | 'storm' | 'temperature_above' | 'temperature_below';
  threshold?: number; // For temperature alerts
  chatId: string;
  userId: string;
  createdAt: Date;
}

interface WeatherData {
  temperature: number;
  feelsLike: number;
  humidity: number;
  pressure: number;
  weather: string;
  description: string;
  windSpeed: number;
  city: string;
}

/**
 * Weather Service to handle weather monitoring and alerts
 */
export class WeatherService extends Service {
  static override serviceType = 'weather';

  override capabilityDescription =
    'Provides weather monitoring and notification functionality.';

  private openWeatherApiKey: string;
  private telegramBotToken: string;
  private telegramChatId: string;
  private weatherCheckInterval: number;
  private alertCheckInterval: number;

  private weatherAlerts: Map<string, WeatherAlert> = new Map();
  private weatherCheckTimer?: NodeJS.Timeout;
  private alertCheckTimer?: NodeJS.Timeout;
  private lastWeatherData: Map<string, WeatherData> = new Map();

  constructor(runtime?: IAgentRuntime) {
    super(runtime);
    this.openWeatherApiKey = process.env.OPENWEATHER_API_KEY || '';
    this.telegramBotToken = process.env.TELEGRAM_BOT_TOKEN || '';
    this.telegramChatId = process.env.TELEGRAM_CHAT_ID || '';
    this.weatherCheckInterval = Number(process.env.WEATHER_CHECK_INTERVAL) || 300000;
    this.alertCheckInterval = Number(process.env.ALERT_CHECK_INTERVAL) || 600000;
  }

  static override async start(runtime: IAgentRuntime): Promise<Service> {
    logger.info('Starting weather service');
    const service = new WeatherService(runtime);
    await service.initialize();
    return service;
  }

  static override async stop(runtime: IAgentRuntime): Promise<void> {
    logger.info('Stopping weather service');
    const service = runtime.getService(WeatherService.serviceType) as WeatherService;
    if (!service) {
      throw new Error('Weather service not found');
    }
    await service.stop();
  }

  override async stop(): Promise<void> {
    if (this.weatherCheckTimer) {
      clearInterval(this.weatherCheckTimer);
    }
    if (this.alertCheckTimer) {
      clearInterval(this.alertCheckTimer);
    }
    logger.info('Weather service stopped');
  }

  async initialize(): Promise<void> {
    // Start monitoring intervals
    this.startWeatherMonitoring();
    this.startAlertMonitoring();
    
    logger.info('Weather service initialized');
  }

  /**
   * Gets current weather data from OpenWeather API
   */
  async getWeatherData(city: string): Promise<WeatherData> {
    try {
      const response = await axios.get('https://api.openweathermap.org/data/2.5/weather', {
        params: {
          q: city,
          appid: this.openWeatherApiKey,
          units: 'metric',
        },
      });

      if (response.status !== 200) {
        throw new Error(`OpenWeather API returned status ${response.status}`);
      }

      const data = response.data;
      
      return {
        temperature: data.main.temp,
        feelsLike: data.main.feels_like,
        humidity: data.main.humidity,
        pressure: data.main.pressure,
        weather: data.weather[0].main,
        description: data.weather[0].description,
        windSpeed: data.wind.speed,
        city: data.name,
      };
    } catch (error) {
      logger.error({ error, city }, 'Failed to get weather data from OpenWeather');
      throw new Error(`Failed to get weather data: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Validates and normalizes chat_id format
   */
  private validateChatId(chatId: string): string {
    // If it's a numeric string (with optional negative sign), return as-is
    if (/^-?\d+$/.test(chatId)) {
      return chatId;
    }
    
    // If it starts with @, return as-is (username format)
    if (chatId.startsWith('@')) {
      return chatId;
    }
    
    // Use default chat_id from environment if invalid format
    if (this.telegramChatId && /^-?\d+$/.test(this.telegramChatId)) {
      logger.warn(`Invalid chat_id "${chatId}", using default chat_id from environment: ${this.telegramChatId}`);
      return this.telegramChatId;
    }
    
    throw new Error(`Invalid chat_id format: "${chatId}". Chat ID must be a numeric string or start with '@'.`);
  }

  /**
   * Properly escapes text for MarkdownV2 format
   */
  private escapeMarkdownV2(text: string): string {
    // Characters that need to be escaped in MarkdownV2: _ * [ ] ( ) ~ ` > # + - = | { } . ! \
    return text.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, '\\$&');
  }

  /**
   * Sends a message via Telegram with proper error handling
   */
  async sendTelegramMessage(message: string, chatId?: string): Promise<void> {
    try {
      const targetChatId = chatId || this.telegramChatId;
      
      // Validate and normalize chat_id
      const validChatId = this.validateChatId(targetChatId);

      const response = await axios.post(
        `https://api.telegram.org/bot${this.telegramBotToken}/sendMessage`,
        {
          chat_id: validChatId,
          text: message,
          parse_mode: 'MarkdownV2',
        },
        {
          timeout: 10000, // 10 second timeout
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );

      if (response.status !== 200) {
        throw new Error(`Telegram API returned status ${response.status}: ${response.data?.description || 'Unknown error'}`);
      }

      logger.info(`Telegram message sent successfully to ${validChatId}`);
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const errorDetails = error.response?.data?.description || error.message;
        logger.error({ 
          error: errorDetails, 
          status: error.response?.status,
          chatId: chatId || this.telegramChatId 
        }, 'Failed to send Telegram message');
        
        // Try sending without MarkdownV2 if parsing failed
        if (error.response?.status === 400 && errorDetails.includes('parse')) {
          logger.info('Retrying message without MarkdownV2 formatting...');
          await this.sendPlainTelegramMessage(message.replace(/\\./g, ''), chatId);
          return;
        }
      }
      throw error;
    }
  }

  /**
   * Sends a plain text message via Telegram (fallback for markdown errors)
   */
  private async sendPlainTelegramMessage(message: string, chatId?: string): Promise<void> {
    try {
      const targetChatId = chatId || this.telegramChatId;
      const validChatId = this.validateChatId(targetChatId);

      const response = await axios.post(
        `https://api.telegram.org/bot${this.telegramBotToken}/sendMessage`,
        {
          chat_id: validChatId,
          text: message,
          // No parse_mode for plain text
        },
        {
          timeout: 10000,
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );

      if (response.status !== 200) {
        throw new Error(`Telegram API returned status ${response.status}: ${response.data?.description || 'Unknown error'}`);
      }

      logger.info(`Plain Telegram message sent successfully to ${validChatId}`);
    } catch (error) {
      logger.error({ error }, 'Failed to send plain Telegram message');
      throw error;
    }
  }

  /**
   * Adds a weather alert
   */
  addWeatherAlert(
    city: string,
    condition: 'rain' | 'snow' | 'storm' | 'temperature_above' | 'temperature_below',
    threshold: number | undefined,
    chatId: string,
    userId: string
  ): string {
    const id = `${city}_${condition}_${threshold || 'none'}_${Date.now()}`;
    const alert: WeatherAlert = {
      id,
      city: city.toLowerCase(),
      condition,
      threshold,
      chatId,
      userId,
      createdAt: new Date(),
    };

    this.weatherAlerts.set(id, alert);
    logger.info(`Weather alert added: ${id}`);
    return id;
  }

  /**
   * Starts weather monitoring
   */
  private startWeatherMonitoring(): void {
    this.weatherCheckTimer = setInterval(async () => {
      // Get unique cities from alerts
      const cities = new Set<string>();
      for (const alert of this.weatherAlerts.values()) {
        cities.add(alert.city);
      }

      // Update weather data for all monitored cities
      for (const city of cities) {
        try {
          const weatherData = await this.getWeatherData(city);
          this.lastWeatherData.set(city.toLowerCase(), weatherData);
        } catch (error) {
          logger.error({ error, city }, 'Error updating weather data');
        }
      }
    }, this.weatherCheckInterval);
  }

  /**
   * Starts alert monitoring with improved message formatting
   */
  private startAlertMonitoring(): void {
    this.alertCheckTimer = setInterval(async () => {
      if (this.weatherAlerts.size === 0) return;

      for (const [alertId, alert] of this.weatherAlerts.entries()) {
        try {
          const weatherData = this.lastWeatherData.get(alert.city);
          if (!weatherData) continue;

          let shouldTrigger = false;
          let alertMessage = '';

          switch (alert.condition) {
            case 'rain':
              shouldTrigger = weatherData.weather.toLowerCase().includes('rain');
              alertMessage = `🌧️ It's raining in ${weatherData.city}!`;
              break;
            
            case 'snow':
              shouldTrigger = weatherData.weather.toLowerCase().includes('snow');
              alertMessage = `❄️ It's snowing in ${weatherData.city}!`;
              break;
            
            case 'storm':
              shouldTrigger = weatherData.weather.toLowerCase().includes('storm') || 
                            weatherData.weather.toLowerCase().includes('thunder');
              alertMessage = `⛈️ There's a storm in ${weatherData.city}!`;
              break;
            
            case 'temperature_above':
              shouldTrigger = alert.threshold !== undefined && weatherData.temperature > alert.threshold;
              alertMessage = `🌡️ Temperature in ${weatherData.city} is above ${alert.threshold}°C! Current: ${weatherData.temperature}°C`;
              break;
            
            case 'temperature_below':
              shouldTrigger = alert.threshold !== undefined && weatherData.temperature < alert.threshold;
              alertMessage = `🌡️ Temperature in ${weatherData.city} is below ${alert.threshold}°C! Current: ${weatherData.temperature}°C`;
              break;
          }

          if (shouldTrigger) {
            // Create unescaped message first
            const unescapedMessage = `🌤️ *Weather Alert*

${alertMessage}

📊 *Current Conditions:*
🌡️ Temperature: ${weatherData.temperature}°C (feels like ${weatherData.feelsLike}°C)
☁️ Weather: ${weatherData.description}
💧 Humidity: ${weatherData.humidity}%
🌪️ Wind Speed: ${weatherData.windSpeed} m/s
📊 Pressure: ${weatherData.pressure} hPa`;

            // Properly escape for MarkdownV2
            const message = this.escapeMarkdownV2(unescapedMessage);

            await this.sendTelegramMessage(message, alert.chatId);
            this.weatherAlerts.delete(alertId);
            logger.info(`Weather alert triggered and removed: ${alertId}`);
          }
        } catch (error) {
          logger.error({ error, alertId }, 'Error processing weather alert');
        }
      }
    }, this.alertCheckInterval);
  }
}

/**
 * Action to set up weather alerts
 */
const setWeatherAlertAction: Action = {
  name: 'SET_WEATHER_ALERT',
  similes: ['WEATHER_ALERT', 'ALERT_WEATHER', 'NOTIFY_WEATHER', 'WEATHER_NOTIFICATION'],
  description: 'Sets up weather alerts for specific conditions in a city',

  validate: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state: State | undefined
  ): Promise<boolean> => {
    if (!message.content.text) return false;

    const text = message.content.text.toLowerCase();
    return (
      text.includes('alert') &&
      text.includes('weather') &&
      (text.includes('rain') || text.includes('snow') || text.includes('storm') || 
       text.includes('temperature') || text.includes('temp'))
    );
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
          text: 'I need a message with text to process your request.',
        };
      }

      const text = message.content.text.toLowerCase();
      
      // Extract city name (simple extraction - in production you'd want more robust parsing)
      const cityMatch = text.match(/in ([a-zA-Z\s]+)/);
      const city = cityMatch ? cityMatch[1].trim() : 'London'; // Default city
      
      // Determine condition and threshold
      let condition: 'rain' | 'snow' | 'storm' | 'temperature_above' | 'temperature_below';
      let threshold: number | undefined;

      if (text.includes('rain')) {
        condition = 'rain';
      } else if (text.includes('snow')) {
        condition = 'snow';
      } else if (text.includes('storm')) {
        condition = 'storm';
      } else if (text.includes('above') || text.includes('over')) {
        condition = 'temperature_above';
        const tempMatch = text.match(/(\d+)°?[cf]?/);
        threshold = tempMatch ? parseInt(tempMatch[1]) : 25;
      } else if (text.includes('below') || text.includes('under')) {
        condition = 'temperature_below';
        const tempMatch = text.match(/(\d+)°?[cf]?/);
        threshold = tempMatch ? parseInt(tempMatch[1]) : 5;
      } else {
        return {
          success: false,
          error: new Error('Unknown weather condition'),
          text: 'Please specify a weather condition (rain, snow, storm, temperature above/below X°C)',
        };
      }

      const service = runtime.getService(WeatherService.serviceType) as WeatherService;
      if (!service) {
        throw new Error('Weather service not available');
      }

      // Use a valid chat_id - either from the message source or the default configured one
      const chatId = message.content.source || process.env.TELEGRAM_CHAT_ID || '';
      
      const alertId = service.addWeatherAlert(
        city,
        condition,
        threshold,
        chatId,
        (message.content.userId as string) || ''
      );

      let response = `✅ Weather alert set successfully!\n\nI'll notify you when there's ${condition.replace('_', ' ')} in ${city}`;
      if (threshold !== undefined) {
        response += ` (${threshold}°C)`;
      }
      response += `.\n\nAlert ID: ${alertId}`;

      if (callback) {
        await callback({
          text: response,
          actions: ['SET_WEATHER_ALERT'],
          source: message.content.source,
        });
      }

      return {
        text: response,
        success: true,
        data: {
          actions: ['SET_WEATHER_ALERT'],
          source: message.content.source,
          alertId,
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to set weather alert';
      return {
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
        text: `Sorry, I couldn't set up the weather alert. ${errorMessage}`,
      };
    }
  },

  examples: [
    [
      {
        name: '{{name1}}',
        content: {
          text: 'Alert me when it rains in London',
        },
      },
      {
        name: '{{name2}}',
        content: {
          text: '✅ Weather alert set successfully!\n\nI\'ll notify you when there\'s rain in London.\n\nAlert ID: london_rain_none_1234567890',
          actions: ['SET_WEATHER_ALERT'],
        },
      },
    ],
    [
      {
        name: '{{name1}}',
        content: {
          text: 'Notify me when temperature goes above 30°C in Paris',
        },
      },
      {
        name: '{{name2}}',
        content: {
          text: '✅ Weather alert set successfully!\n\nI\'ll notify you when there\'s temperature above in Paris (30°C).\n\nAlert ID: paris_temperature_above_30_1234567890',
          actions: ['SET_WEATHER_ALERT'],
        },
      },
    ],
  ],
};

/**
 * Action to get current weather
 */
const getCurrentWeatherAction: Action = {
  name: 'GET_CURRENT_WEATHER',
  similes: ['WEATHER_NOW', 'CURRENT_WEATHER', 'WEATHER_CHECK', 'WEATHER_INFO'],
  description: 'Gets current weather information for a specified city',

  validate: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state: State | undefined
  ): Promise<boolean> => {
    if (!message.content.text) return false;

    const text = message.content.text.toLowerCase();
    return (
      text.includes('weather') &&
      (text.includes('current') || text.includes('now') || text.includes('today') ||
       text.includes('what') || text.includes('how'))
    );
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
          text: 'I need a message with text to process your request.',
        };
      }

      const text = message.content.text.toLowerCase();
      
      // Extract city name
      const cityMatch = text.match(/in ([a-zA-Z\s]+)/);
      const city = cityMatch ? cityMatch[1].trim() : 'London'; // Default city

      const service = runtime.getService(WeatherService.serviceType) as WeatherService;
      if (!service) {
        throw new Error('Weather service not available');
      }

      const weatherData = await service.getWeatherData(city);

      const response = `🌤️ Current weather in ${weatherData.city}:

🌡️ Temperature: ${weatherData.temperature}°C (feels like ${weatherData.feelsLike}°C)
☁️ Conditions: ${weatherData.description}
💧 Humidity: ${weatherData.humidity}%
🌪️ Wind Speed: ${weatherData.windSpeed} m/s
📊 Pressure: ${weatherData.pressure} hPa`;

      if (callback) {
        await callback({
          text: response,
          actions: ['GET_CURRENT_WEATHER'],
          source: message.content.source,
        });
      }

      return {
        text: response,
        success: true,
        data: {
          actions: ['GET_CURRENT_WEATHER'],
          source: message.content.source,
          weatherData,
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to get weather data';
      return {
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
        text: `Sorry, I couldn't get the weather information. ${errorMessage}`,
      };
    }
  },

  examples: [
    [
      {
        name: '{{name1}}',
        content: {
          text: 'What\'s the weather like in New York?',
        },
      },
      {
        name: '{{name2}}',
        content: {
          text: '🌤️ Current weather in New York:\n\n🌡️ Temperature: 22°C (feels like 24°C)\n☁️ Conditions: partly cloudy\n💧 Humidity: 65%\n🌪️ Wind Speed: 3.5 m/s\n📊 Pressure: 1013 hPa',
          actions: ['GET_CURRENT_WEATHER'],
        },
      },
    ],
  ],
};

export const weatherPlugin: Plugin = {
  name: 'plugin-weather-notification',
  description: 'Provides weather monitoring and notification functionality',
  config: {
    OPENWEATHER_API_KEY: process.env.OPENWEATHER_API_KEY,
    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
    TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID,
    WEATHER_CHECK_INTERVAL: process.env.WEATHER_CHECK_INTERVAL,
    ALERT_CHECK_INTERVAL: process.env.ALERT_CHECK_INTERVAL,
  },
  
  async init(config: Record<string, string>) {
    logger.info('Initializing plugin-weather-notification');
    try {
      const validatedConfig = await configSchema.parseAsync({
        ...config,
        WEATHER_CHECK_INTERVAL: Number(config.WEATHER_CHECK_INTERVAL) || 300000,
        ALERT_CHECK_INTERVAL: Number(config.ALERT_CHECK_INTERVAL) || 600000,
      });

      // Set all environment variables at once
      for (const [key, value] of Object.entries(validatedConfig)) {
        if (value) process.env[key] = String(value);
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
      return 'I can help you monitor weather conditions and set up weather alerts for any city.';
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
      return 'I specialize in weather monitoring and notifications. You can ask me about current weather conditions like "What\'s the weather in London?" or set up alerts like "Alert me when it rains in Paris" or "Notify me when temperature goes above 30°C in Madrid". I\'ll send you Telegram notifications when your weather conditions are met.';
    },
  },

  routes: [
    {
      name: 'api-weather-current',
      path: '/api/weather/current',
      type: 'GET',
      handler: async (req: any, res: any) => {
        try {
          const service = req.runtime.getService(WeatherService.serviceType) as WeatherService;
          if (!service) {
            return res.status(500).json({ error: 'Weather service not available' });
          }

          const city = req.query.city as string || 'London';
          const weatherData = await service.getWeatherData(city);
          res.json(weatherData);
        } catch (error) {
          res.status(500).json({
            error: 'Failed to get weather data',
            details: error instanceof Error ? error.message : String(error),
          });
        }
      },
    },
    {
      name: 'api-weather-alerts',
      path: '/api/weather/alerts',
      type: 'GET',
      handler: async (req: any, res: any) => {
        try {
          const service = req.runtime.getService(WeatherService.serviceType) as WeatherService;
          if (!service) {
            return res.status(500).json({ error: 'Weather service not available' });
          }

          // In a real implementation, you'd expose the alerts from the service
          res.json({ message: 'Weather alerts endpoint - implementation depends on your needs' });
        } catch (error) {
          res.status(500).json({
            error: 'Failed to get weather alerts',
            details: error instanceof Error ? error.message : String(error),
          });
        }
      },
    },
  ],

  events: {
    [EventType.MESSAGE_RECEIVED]: [
      async (params: MessagePayload) => {
        logger.debug('MESSAGE_RECEIVED event received in weather plugin');
        logger.debug({ message: params.message }, 'Message:');
      },
    ],
  },

  services: [WeatherService],
  actions: [setWeatherAlertAction, getCurrentWeatherAction],
  providers: [],
};

export default weatherPlugin;