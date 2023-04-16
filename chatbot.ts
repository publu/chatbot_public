
import _ from "npm:lodash@^4.17.21"
import { ChatGPTAPI, ChatMessage } from "npm:chatgpt@5.0.6"
import { Client, GatewayIntentBits } from "npm:discord.js@14.8.0"

// @deno-types="npm:@types/node-telegram-bot-api@^0.57.6"
import TelegramBot from "npm:node-telegram-bot-api@^0.60.0"

import { encode } from "https://deno.land/std/encoding/base64.ts";

import "https://deno.land/x/dotenv@v3.2.0/load.ts"
import ogs from 'npm:open-graph-scraper@5.2.2';

const BOT_TOKEN = Deno.env.get("BOT_TOKEN")
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY")

if (!BOT_TOKEN || !OPENAI_API_KEY) {
    logWithTime("⛔️ BOT_TOKEN and OPENAI_API_KEY must be set")
    Deno.exit(1)
}

const DISCORD_BOT_TOKEN = Deno.env.get("DISCORD");

if (!DISCORD_BOT_TOKEN) {
  console.error('⛔️ DISCORD_BOT_TOKEN must be set');
  Deno.exit(1);
}

const client = new Client({ 
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
  ]
});

interface Event {
  id: number;
  created_at: string;
  name: string;
  startDate: string;
  startTime: string;
  tags: string[];
  info: string;
  event_id: number;
  hasTicket: boolean;
  team_members: {
    name: string;
    role: string;
  }[];
  equipment: string;
  subevent_id: number | null;
  description: string;
  event_slug: string;
  event_item_id: number;
  event_type: string;
  format: string;
  track: string;
  level: string;
  location: string;
  quota_id: number | null;
  creator_uuid: string;
  duration: string;
  creator_id: number | null;
  custom_location: string | null;
  favoritedSessions: any[];
  participants: any[];
  events: {
    id: number;
    created_at: string;
    name: string;
    location: string;
    startDate: string;
    endDate: string;
    startTime: string;
    tags: string[];
    endTime: string;
    info: string | null;
    organizers: string[];
    slug: string;
    publicUrl: string;
    type: string;
    item_id: number;
    order: number | null;
    image_url: string;
    bg_image_url: string;
    apply_form: string;
  };
}

type Event = {
  name: string;
  startDate: string;
  startTime: string;
  tags: string[];
  event_id: number;
  team_members: { name: string; role: string }[];
  description: string;
  eventType: string;
  level: string;
  location: string;
  duration: string;
  eventDetails: {
    name: string;
    location: string;
    startDate: string;
    endDate: string;
    startTime: string;
    endTime: string;
    organizers: string[];
    publicUrl: string;
    imageUrl: string;
  };
};

function simplifyEvents(events: any[]): string {
  const simplifiedEvents: SimpleEvent[] = events.map((event) => ({
    name: event.name,
    startDate: event.startDate,
    startTime: event.startTime,
    event_id: event.event_id,
    team_members: event.team_members,
    description: event.description,
    eventType: event.event_type,
    level: event.level,
    location: event.location,
    duration: event.duration,
    eventDetails: {
      name: event.events.name,
      location: event.events.location,
      startDate: event.events.startDate,
      endDate: event.events.endDate,
      startTime: event.events.startTime,
      endTime: event.events.endTime,
      organizers: event.events.organizers,
    },
  }));

  let result = '';

  simplifiedEvents.forEach((event, index) => {
    result += `-`;
    result += `Name: ${event.name}`; //${event.description} `;
    result += `Date: ${event.startDate} ${event.startTime} `;
    result += `at ${event.location} ending at ${event.eventDetails.endTime} for ${event.duration} mins\n`;
    //result += `Type: ${event.eventType}\n`;
    //result += `Organizers: ${event.eventDetails.organizers.join(', ')}\n`;
  });
  //logWithTime("events size: ", result.length)

//    const encoder = new TextEncoder();
//    const encoded = encode(encoder.encode(result));

  return result;
}

const events: Event[] = [
  // your array of events goes here
];

function filterEventsFromToday(events: Event[], today: string): string {
  const startDate = new Date(today);
  const endDate = new Date(today);
  startDate.setDate(endDate.getDate() - 8); // Add 2 days to include events that occur within the next 7 days
  endDate.setDate(endDate.getDate() + 3); // Add 2 days to include events that occur within the next 7 days
  return simplifyEvents(events.filter(event => {
      const eventDate = new Date(event.startDate);
      return eventDate >= startDate && eventDate < endDate;
    }))
}

function convertTo24Hour(time: string): string {
    if(time.includes("AM") || time.includes("PM")){
        const [hour, minuteAndPeriod] = time.split(':');
        const [minute, period] = minuteAndPeriod.split(' ');

        let hour24 = parseInt(hour, 10);
        if (period.toUpperCase() === 'PM' && hour24 !== 12) {
        hour24 += 12;
        } else if (period.toUpperCase() === 'AM' && hour24 === 12) {
        hour24 = 0;
        }

        return `${hour24.toString().padStart(2, '0')}:${minute}`;
    } else {
        return time;
    }

}

const addedUserIds: string[] = [];

const conversationIds: Record<string, [string, string]> = {};

const YOUR_USER_ID = 698874764;

const notifiedUnidentifiedUsers = new Set<number>();

// Start telegram bot

const bot = new TelegramBot(BOT_TOKEN, {
  polling: true,
  can_read_all_group_messages: true
});

const botInfo = await bot.getMe()
console.log("botInfo")
console.log(JSON.stringify(botInfo))
const botName = botInfo.username ?? ""

if (!botName) {
    logWithTime("⛔️ Bot username not found")
    Deno.exit(1)
} else {
    logWithTime("🤖 Bot", `@${botName}`, "has started...")
}

const channelLinks: Record<string, {guild: string, channel: string}> = {};

async function saveChannelLinks() {
    const encoder = new TextEncoder();
    const data = encoder.encode(JSON.stringify(channelLinks));
    await Deno.writeFile("channelLinks.json", data);
}

async function loadChannelLinks() {
    try {
        const decoder = new TextDecoder("utf-8");
        const data = await Deno.readFile("channelLinks.json");
        const loadedLinks = JSON.parse(decoder.decode(data));
        Object.assign(channelLinks, loadedLinks);
    } catch (err) {
        console.log("Error reading channelLinks.json:", err.message);
    }
}

interface LinkData {
  chatLinks: Record<string, string>;
  photoLinks: Record<string, { timestamp: number; channelId: number }>;
}

const chatLinks: Record<string, string> = {};
const photoLinks: Record<string, { timestamp: number; channelId: number }> = {};

async function saveLinks(): Promise<void> {
  const encoder = new TextEncoder();
  const data: Uint8Array = encoder.encode(JSON.stringify({
    chatLinks,
    photoLinks,
  }));
  await Deno.writeFile("links.json", data);
}

async function loadLinks(): Promise<void> {
  try {
    const decoder = new TextDecoder("utf-8");
    const data: Uint8Array = await Deno.readFile("links.json");
    const loadedData: LinkData = JSON.parse(decoder.decode(data));
    Object.assign(chatLinks, loadedData.chatLinks);
    Object.assign(photoLinks, loadedData.photoLinks);
  } catch (err) {
    console.log("Error reading links.json:", err.message);
  }
}

async function savePhotoLink(messageId: string, timestamp: number, channelId: number): Promise<void> {
  photoLinks[messageId] = { timestamp, channelId };
  await saveLinks();
}

async function loadPhotoLinks(): Promise<Record<string, { timestamp: number; channelId: number }>> {
  await loadLinks();
  return photoLinks;
}

await loadChannelLinks();

try {
  const decoder = new TextDecoder("utf-8");
  const data = await Deno.readFile("addedUserIds.txt");
  const lines = decoder.decode(data).split("\n");
  addedUserIds.push(...lines.filter((line) => line !== ""));
} catch (err) {
  console.log("Error reading addedUserIds.txt:", err.message);
}

// Start ChatGPT API
let chatGPTAPI: ChatGPTAPI
try {
    chatGPTAPI = new ChatGPTAPI({
        apiKey: OPENAI_API_KEY,
        completionParams: {
            model: 'gpt-3.5-turbo'
        }
    })
} catch (err) {
    logWithTime("⛔️ ChatGPT API error:", err.message)
    Deno.exit(1)
}
logWithTime("🔮 ChatGPT API has started...")

// Initialize convertionID and parentMessageID
let conversationID: string | undefined
let parentMessageID: string | undefined

// Handle messages
bot.on("message", async (msg) => {
    console.log(msg)
    await handleMessage(msg)
})

bot.on('update', (update) => {
  console.log('Update received:');
  console.log(update);
});

interface MessageCount {
  likes: number;
  dislikes: number;
}

const messageCounts: Record<string, MessageCount> = {}; // Object to store the message counts

// Map of message IDs to user IDs and their votes on the message
const votes: Map<string, Map<number, string>> = new Map();

let savedVotes = [];
// Load the saved votes from file
try {
  const data = await Deno.readFile("votes.json");
  savedVotes = JSON.parse(new TextDecoder().decode(data));
  for (const [messageId, votesData] of Object.entries(savedVotes)) {
    const voters = new Map<number, string>();
    for (const [userId, vote] of Object.entries(votesData)) {
      voters.set(Number(userId), vote as string);
    }
    votes.set(messageId, voters);
  }

  console.log(`Loaded ${votes.size} saved votes`);

  const countsData = await Deno.readFile("messageCounts.json");
  const savedCounts = JSON.parse(new TextDecoder().decode(countsData));
  for (const [messageId, counts] of Object.entries(savedCounts)) {
    messageCounts[messageId] = counts;
  }
  console.log(`Loaded ${Object.keys(messageCounts).length} saved message counts`);
} catch (err) {
  console.log("Error reading votes.json or messageCounts.json:", err.message);
}

const saveVotes = async (votes: Map<string, Map<number, string[]>>) => {
  const encoder = new TextEncoder();
  const data = encoder.encode(JSON.stringify([...votes.entries()].map(([messageId, voters]) => [messageId, Object.fromEntries(voters.entries())])));
  await Deno.writeFile("votes.json", data);
  console.log("Votes saved to votes.json");

  const countsData = encoder.encode(JSON.stringify(messageCounts));
  await Deno.writeFile("messageCounts.json", countsData);
  console.log("Message counts saved to messageCounts.json");
};

bot.on('callback_query', async (query) => {
  const [action, messageId] = query.data.split('_');
  messageCounts[messageId] = messageCounts[messageId] || { likes: 0, dislikes: 0 };

  const userId = query.from.id;
  let voters = votes.get(messageId);

  if (!voters) {
    // Load the saved data for the message if not present in the current session
    const savedVotersData = savedVotes[messageId];
    if (savedVotersData) {
      voters = new Map<number, string>(Object.entries(savedVotersData).map(([userId, vote]) => [Number(userId), vote as string]));
      votes.set(messageId, voters);
    } else {
      voters = new Map();
    }
  }

  const previousVote = voters.get(userId);

  if (previousVote === action) {
    // User tried to vote the same thing, do nothing
    console.log(`User ${userId} tried to vote the same thing for message ${messageId}`);
    return;
  }

  if (previousVote) {
    // Remove the user's previous vote
    console.log(`Removed ${userId}'s previous vote (${previousVote}) for message ${messageId}`);
    if (previousVote === 'like') {
      messageCounts[messageId].likes -= 1;
    } else if (previousVote === 'dislike') {
      messageCounts[messageId].dislikes -= 1;
    }
  }

  if (action === 'like') {
    // Increment the like count for the message
    messageCounts[messageId].likes += 1;
    console.log(`Added ${userId}'s like vote for message ${messageId}`);
  } else if (action === 'dislike') {
    // Increment the dislike count for the message
    messageCounts[messageId].dislikes += 1;
    console.log(`Added ${userId}'s dislike vote for message ${messageId}`);
  }

  // Update the message caption with the new count
  const messageCount = messageCounts[messageId];
  const replyMarkup = {
    inline_keyboard: [[
      { text: `👍 ${messageCount.likes}`, callback_data: `like_${messageId}` },
      { text: `👎 ${messageCount.dislikes}`, callback_data: `dislike_${messageId}` }
    ]]
  };
  try {
    await bot.editMessageCaption(query.message.caption, {
      chat_id: query.message.chat.id,
      message_id: query.message.message_id,
      reply_markup: replyMarkup,
      parse_mode: 'Markdown'
    });
  } catch (e) {}

  // Add the user's vote to the map
  voters.set(userId, action);
  votes.set(messageId, voters);
  await saveVotes(votes);
});

bot.on("channel_post", async (msg) => {
  console.log(msg)
  await handleMessage(msg)
})

async function createEvent(
  description: string,
  name: string,
  organizer: string,
  date: string,
  time: string,
  location: string,
  equipment: string,
  tags: string[] = ['tag']
): Promise<void> {
    const response = fetch("https://zuzalu.city/api/createSession", {
      "headers": {
        "accept": "application/json, text/plain, */*",
        "accept-language": "en-US,en;q=0.9",
        "content-type": "application/json",
        "sec-ch-ua": "\"Google Chrome\";v=\"111\", \"Not(A:Brand\";v=\"8\", \"Chromium\";v=\"111\"",
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": "\"macOS\"",
        "sec-fetch-dest": "empty",
        "sec-fetch-mode": "cors",
        "sec-fetch-site": "same-origin",
        "cookie": "supabase-auth-token=%5B%22eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJhdWQiOiJhdXRoZW50aWNhdGVkIiwiZXhwIjoxNjgxMjM4MDUwLCJzdWIiOiIyMDRkZTc2Zi0zNzRjLTRlYjgtYTg4OS0yNjc5OGE0Y2RmMjIiLCJlbWFpbCI6InBhYmxvQGhhc2hpbmdzeXN0ZW1zLmNvbSIsInBob25lIjoiIiwiYXBwX21ldGFkYXRhIjp7InByb3ZpZGVyIjoiZW1haWwiLCJwcm92aWRlcnMiOlsiZW1haWwiXX0sInVzZXJfbWV0YWRhdGEiOnsiY29tbWl0bWVudCI6IjEzMDQxOTk1NzU1NDMwMzI5NjQ4NzcxOTgyOTY1MDk5OTc3NjE1NjA3MjIxMTYxMzgxMTAwNjA5MjU1MDQ3NTcwMDczMTEwMTIwNTcxIiwiZW1haWwiOiJwYWJsb0BoYXNoaW5nc3lzdGVtcy5jb20iLCJuYW1lIjoiUGFibG8gUGVuZ3VpbiIsIm9yZGVyX2lkIjoiWUFDR1kiLCJyZXNpZGVuY2UiOiIiLCJyb2xlIjoicmVzaWRlbnQiLCJ1dWlkIjoiNGYxZjlkZDQtYjdmOS00OGU4LWFkZTktZDEzZGExMDRjZjJjIn0sInJvbGUiOiJhdXRoZW50aWNhdGVkIiwiYWFsIjoiYWFsMSIsImFtciI6W3sibWV0aG9kIjoicGFzc3dvcmQiLCJ0aW1lc3RhbXAiOjE2ODA2MzMyNTB9XSwic2Vzc2lvbl9pZCI6IjJkYmIyNGMyLTA4YTQtNGE5Ni05MWNmLTFkZmY1ZTI2NTgxNiJ9.hJI5DXoz3u__QOcKXwlP6hUWVnC-qvLsIIhDL3NfNb0%22%2C%22DrtMumwE7ns48iLX2b2g0Q%22%2Cnull%2Cnull%2Cnull%5D",
        "Referer": "https://zuzalu.city/full-program",
        "Referrer-Policy": "strict-origin-when-cross-origin"
      },
      "body": `{\"description\":\"<p>${description}</p>\",\"name\":\"${name}\",\"team_members\":[{\"name\":\"${organizer}\",\"role\":\"Speaker\"}],\"startDate\":\"${date}T18:36:58.000Z\",\"startTime\":\"${time}\",\"location\":\"Other\",\"custom_location\":\"${location}\",\"tags\":[\"tag\"],\"info\":\"${description} \",\"event_id\":101,\"hasTicket\":false,\"duration\":\"69\",\"format\":\"Live\",\"level\":\"Beginner\",\"equipment\":\"${equipment}\",\"track\":\"Other\",\"event_type\":\"Workshop\",\"event_slug\":\"open-sessions-series\",\"event_item_id\":130}`,
      "method": "POST"
    });

    logWithTime("response!!: ", response);
}

async function getEvents(): Promise<Event[]> {
  const response = await fetch(`https://zuzalu.city/api/fetchSessionsByUserId/1`);
  const data = await response.json();
  return data;
}

async function fetchOpenGraphData(url: string) {
  try {
    const { error, result } = await ogs({ url });

    if (error) {
      console.error('Error fetching Open Graph data:', error);
      return null;
    }

    return result;
  } catch (error) {
    console.error('Error fetching Open Graph data:', error);
    return null;
  }
}

let context = "";

async function fetchDiscordMessages(guildID: string, channelID: string, limit: number) {
    client.login(DISCORD_BOT_TOKEN);

    //const guildID = '829965540084285450';
    //const channelID = '829965540444602374';

    const guild = await client.guilds.fetch(guildID);
    const channel = await guild.channels.fetch(channelID);

    let output  = "";

    const messages = await channel.messages.fetch({ limit: limit }); // Fetch the last 20 messages
    messages.forEach(message => {
        var date = new Date(message.createdTimestamp);
        //var currentDate =  new Date(client.readyTimestamp*1000);

        const month = date.getMonth() + 1; // adding 1 to get month in 1-12 format
        const day = date.getDate();

        var dateString = `${month}/${day}`

        output+=`${message.author.username} on ${dateString} said """${message.content}"""\n`
    });
    output+= "Here are the latest messages from the channel in our Discord server. Please let me know if you have any thoughts on these messages.\n"
    output += `Messages from ${channel.name}\nTopic: ${channel.topic}\n`;
    output+="send me a summary of the conversations and list users with their emotion levels\n";
    //output+=`today is ${client.readyTimestamp}`;

    return output;
}

async function handleCommand(msg: TelegramBot.Message): Promise<boolean> {
    const trimedText = msg.text?.replace(`@${botName}`, "").trim()

    // reload command
    if (trimedText === "/reload" || trimedText == "/reset") {
        conversationID = undefined
        parentMessageID = undefined

        delete conversationIds[String(msg.chat.id)];

        bot.sendMessage(msg.chat.id, "🔄 Conversation has been reset, enjoy!")
        logWithTime("🔄 Conversation has been reset")
        return true
    }

    if (trimedText.startsWith("/disc ") || trimedText.startsWith("/discord ")) {
        const commands = trimedText.split(" ");
        const limit = commands.length == 3 ? Number(commands[3]) : 100;

        context = await fetchDiscordMessages(commands[1], commands[2], commands[3])
        return false
    }

    if (trimedText.startsWith("/events")) {
        function formatDate(date: Date): string {
          return date.toISOString().slice(0, 10);
        }
        const today = new Date().toLocaleString("en-US", { timeZone: "Europe/Podgorica" }).split(",")[0].split("/");
        const formattedDate = `${today[2]}-${today[0].padStart(2, "0")}-${today[1].padStart(2, "0")}`;
    
        logWithTime("today is: ", formattedDate)
        const events = await getEvents();
        context = "events for today and next few days (sourced from zuzalu.city) Today is " + today + await filterEventsFromToday(events, formattedDate);
        return false;
    }
    if (trimedText.startsWith("/event")) {        
        context = "The user has sent you an event request. You'll create an event message with each of these items (and only those items, nothing more!) Please provide me with the 'Event Name', 'Description', 'Start Date' (in YYYY-MM-DD format), 'Start Time' (in hh:mm format), 'Location' (string), and 'Organizer' (string). If applicable, please also include any equipment required for the event 'Equipment'. If any information is missing, I will ask you to provide it before generating the complete event details. Once the event is fully complete and no modifications are required, generate the event details and chatgpt will include #event in the reply message. Organizer will be the user sending the message."
        return false;
    }

    if (trimedText.startsWith("/add ")) {
      const userId = trimedText.substring(5).trim();
      if (!userId) {
        bot.sendMessage(msg.chat.id, "❌ Please provide a user ID to add.");
        return true;
      }
      addedUserIds.push(userId);
      const encoder = new TextEncoder();
      await Deno.writeFile("addedUserIds.txt", encoder.encode(addedUserIds.join("\n")));
      bot.sendMessage(msg.chat.id, `✅ User ${userId} has been added to the chat.`);
      bot.sendMessage(userId, `✅ You've has been added to the chat.`);
      return false;
    }

    if (trimedText.startsWith("/channel ")) {
        const commands = trimedText.split(" ");
        if (commands.length === 4) {
            channelLinks[commands[1]] = {
                guild: commands[2],
                channel: commands[3],
            };
            await saveChannelLinks();
            bot.sendMessage(msg.chat.id, `✅ Channel link ${commands[1]} has been added.`);
        } else {
            bot.sendMessage(msg.chat.id, "❌ Invalid command format. Usage: /channel <channel_name> <guild_id> <channel_id>");
        }
        return true;
    }

    // help command
    if (trimedText === "/help") {
        bot.sendMessage(msg.chat.id, "🤖 This is a chatbot powered by Rubber Ducky. You can use the following commands:\n\n/reload - Reset the conversation\n/help - Show this message")
        return true
    }
    return false
}

type EventInfo = {
  "Event name": string;
  "Description": string;
  "Start Date": string;
  "Start Time": string;
  "Location": string;
  "Organizer": string;
  "Equipment": string;
} | false;

function processMessage(inputMessage: string): EventInfo {
  const requiredKeys = ["Event Name", "Description", "Start Date", "Start Time", "Location", "Organizer"] as const;
  let jsonObject: Partial<EventInfo> = {};

  const messageLines = inputMessage.split("\n");
  
  for (const line of messageLines) {
    const keyValue = line.split(": ");
    if (keyValue.length === 2) {
      const key = keyValue[0].trim();
      const value = keyValue[1].trim();
      jsonObject[key as keyof EventInfo] = value;

      if(key == "Start Time") {
        jsonObject[key as keyof EventInfo] = convertTo24Hour(value);
      }
    }
  }
  
  for (const requiredKey of requiredKeys) {
    if (!jsonObject.hasOwnProperty(requiredKey)) {
    console.log("missing: ", requiredKey)
      return false;
    }
  }
  
  return jsonObject as EventInfo;
}

async function fetchChannelMessages(channelName: string, limit: number) {
    if (!channelLinks[channelName]) {
        return `❌ Channel link ${channelName} not found.`;
    }
    
    const { guild: guildID, channel: channelID } = channelLinks[channelName];
    return await fetchDiscordMessages(guildID, channelID, limit);
}

// Parse message and send to ChatGPT if needed
async function handleMessage(msg: TelegramBot.Message) {
    context = "";

    const chatId = msg.chat.id
    const CHANNEL_ID = "-1001983251677";
    if(msg.chat.id == "-1001983251677") {
      return;
    }

    if (msg.chat.type === 'private' && msg.photo) {
    // Get the largest photo size
    const photo = msg.photo.pop();

    // Get the ID of the chat where the photo was sent
    const channelId = msg.chat.id;

    // Save the photo link along with the channel ID
    await savePhotoLink(String(msg.message_id), msg.date, channelId);

    // Get the file ID of the photo
    const fileId = photo.file_id;

    // Download the photo from Telegram's servers
    const fileStream = await bot.getFileStream(fileId);

    // Create the message caption
    let caption;//`Photo from @${msg.from.username}`;
    if(msg.caption){
      caption = `"${msg.caption}" - @${msg.from.username}`;
    } else{
      caption = `@${msg.from.username}`;
    }
    // Send the photo to the target channel with the caption and like/dislike buttons
    const sentMsg = await bot.sendPhoto(CHANNEL_ID, fileStream, {
      caption: caption,
      reply_markup: {
        inline_keyboard: [
          [
            { text: '👍', callback_data: `like_${msg.message_id}` },
            { text: '👎', callback_data: `dislike_${msg.message_id}` },
          ]
        ]
      }
    });

    console.log(`Photo ${fileId} forwarded to channel ${CHANNEL_ID}`);
    }

    if (!msg.text) {
        return
    }

    console.log("User ID:", msg.from?.id, YOUR_USER_ID, YOUR_USER_ID==msg.from?.id);
    if (!addedUserIds.includes(msg.chat?.id?.toString() ?? "") && !(msg.chat.type === "group" || msg.chat.type === "supergroup")) {
        if (!msg.from || msg.from.id !== YOUR_USER_ID) {
            if (!notifiedUnidentifiedUsers.has(msg.chat.id)) {
                logWithTime("new user trying to message", msg.chat.username, msg.chat.id, YOUR_USER_ID)
                bot.sendMessage(msg.chat.id, "if you want dm access message @pablothepenguin");
                bot.sendMessage(YOUR_USER_ID, "👤 Someone with chat ID " + msg.chat.id + " is trying to access me." + " @" + msg.chat.username + " `/add " + msg.chat.id +"`");
                notifiedUnidentifiedUsers.add(msg.chat.id);
            }
            return true;
        }
    }

    let count=0;
    console.log(count++)
    // Only respond to messages that start with @botName or a valid command in a group chat
    if (msg.chat.type === "group" || msg.chat.type === "supergroup" && !(msg.text.startsWith("/") && msg.chat.title == "Zuzalu Hub" || msg.chat.title == "zuzafrens")) {
        if (!msg.text.includes(`${botName}`) || !msg.text.toLowerCase().includes(`ducky`)) {
            if(msg.reply_to_message){
                if(msg.reply_to_message.from.username!=botName){
                    console.log("not replying to me :/")
                    return;
                }
            } else{

                console.log(msg)
                console.log("nothing")
                return;
            }
        } else {
            // does include bot name, but could be a reply to bot?
            if(msg.reply_to_message){
                context = `The user is tagging you in this message, written by ${msg.reply_to_message.from.first_name}, and the message is: ${msg.reply_to_message.text}`
            }
            logWithTime("group message from", msg.chat.username, msg.chat.id)
        }
    }
    console.log(count++)

    // Handle commands if needed
    if (await handleCommand(msg)) {
        return
    }
    console.log(count++)

    // Remove @botName from message
    let message = msg.text.replace(`@${botName}`, "").trim()
    if (message === "" && context.length == 0) {
        return
    }
    console.log(count++)

    // Check if the message starts with #
    if (message.startsWith("#")) {
        const commands = message.split(" ");/*.substring(1).trim();*/
        const channelName = commands[0]
        const limit = commands.length==2 ? commands[1] : 100
        context = await fetchChannelMessages(channelName, limit);
        logWithTime(`Fetching Channel Messages from ${channelName}`, context)
        //return;
    }

    logWithTime(`📩 Message from ${msg.chat.id} ${msg.chat.username}:`, message)

    // Send a message to the chat acknowledging receipt of their message
    let respMsg: TelegramBot.Message
    try {
        respMsg = await bot.sendMessage(chatId, "🤔", {
            reply_to_message_id: msg.message_id,
        })
        bot.sendChatAction(chatId, "typing")
    } catch (err) {
        logWithTime("⛔️ Telegram API error:", err.message)
        return
    }

    // Check if the message contains a URL
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const urlMatches = message.match(urlRegex);

    if (urlMatches && urlMatches.length > 0) {
        // Fetch Open Graph data for the first URL found
        const openGraphData = await fetchOpenGraphData(urlMatches[0]);

        if (openGraphData) {
            // Pass the fetched data to your ChatGPT API call as contextData
            console.log('Open Graph data:', openGraphData);
            const title = openGraphData.ogTitle ? `Title: ${openGraphData.ogTitle}\n` : "";
            const description = openGraphData.ogDescription ? `Description: ${openGraphData.ogDescription}\n` : "";
            const url = openGraphData.ogUrl ? `URL: ${openGraphData.ogUrl}\n` : "";
            const customPrompt = `The user asked:\n"${message}"\n\nThe following information was found on the web:\n${title}${description}${url}\nWhat are your thoughts on this?`;
            message = customPrompt;
        }
    }

    console.log(message);

    if(context != ""){
        logWithTime("context: ", context)
        message  += " context: " + context;
        context = "";
    }

    const date = new Date(msg.date * 1000);
    const dateString = date.toLocaleDateString('en-US', { year: 'numeric', month: '2-digit', day: '2-digit' });
    const timeString = date.toLocaleTimeString('en-US', { hour12: true, hour: 'numeric', minute: 'numeric', second: 'numeric' });
    console.log(`${dateString} ${timeString}`);

    message = `You're Rubber Ducky (a chatbot). Message from ${msg.from.first_name} ${msg.from.last_name} (username: ${msg.chat.username}) on ${dateString} ${timeString} \n message:  ` + message + ". Respond in first person directly. Keep your response Short and simple unless asked otherwise."
    // Send message to ChatGPT
    try {
        //logWithTime("WOOO: ", message.length, message)
        let conversationID_;
        let parentId;
        if(conversationIds[String(msg.chat.id)]){
            conversationID_ = conversationIds[String(msg.chat.id)][0]
            parentId = conversationIds[String(msg.chat.id)][1]
        }
        const response: ChatMessage = await chatGPTAPI.sendMessage(message, {
            conversationId: conversationID_,
            parentMessageId: parentId,
            onProgress: _.throttle(async (partialResponse: ChatMessage) => {
                respMsg = await editMessage(respMsg, partialResponse.text, false)
                bot.sendChatAction(chatId, "typing")
            }, 4000, { leading: true, trailing: false }),
        })
        // Update conversationID and parentMessageID
        conversationIds[String(msg.chat.id)] = [];

        conversationIds[String(msg.chat.id)][0] = response.conversationId
        conversationIds[String(msg.chat.id)][1] = response.id
        editMessage(respMsg, response.text)
        logWithTime("📨 Response:", response)

        if(response.text.includes("#event")) {
            logWithTime("this response includes an event tag!");
            const obj = processMessage(response.text);

            if(obj) {
                console.log(
                  obj.Description,
                  obj["Event Name"],
                  obj.Organizer,
                  obj["Start Date"],
                  obj["Start Time"],
                  obj.Location,
                  obj.Description,
                  ["telegram"]
                )
                
                await createEvent(
                  obj.Description,
                  obj["Event Name"],
                  obj.Organizer,
                  obj["Start Date"],
                  obj["Start Time"],
                  obj.Location,
                  obj.Description,
                  ["telegram"]
                )
            }
            logWithTime("Event: ", obj);
            if(!obj){
                bot.sendMessage(chatId, "⛔️ Could not create event. Please make sure its formatted correctly")
            } else{
                bot.sendMessage(chatId, "🎟 Event created! reply with /events to view it in the list")
            }
        }
    } catch (err) {
        logWithTime("⛔️ ChatGPT API error:", err.message)
        // If the error contains session token has expired, then get a new session token
        if (err.message.includes("session token may have expired")) {
            bot.sendMessage(chatId, "🔑 Token has expired, please update the token.")
        } else {
            bot.sendMessage(chatId, "🤖 Sorry, I'm having trouble connecting to the server, please try again later.")
        }
    }
}

// Edit telegram message
async function editMessage(msg: TelegramBot.Message, text: string, needParse = true): Promise<TelegramBot.Message> {
    if (msg.text === text || !text  || text.trim() === "") {
        return msg
    }
    try {
        const resp = await bot.editMessageText(text, {
            chat_id: msg.chat.id,
            message_id: msg.message_id,
            parse_mode: needParse ? "Markdown" : undefined,
        })
         // type of resp is boolean | Message
        if (typeof resp === "object") {
            // return a Message type instance if resp is a Message type
            return resp as TelegramBot.Message;
        } else {
            // return the original message if resp is a boolean type
            return msg;
        }
    } catch (err) {
        logWithTime("⛔️ Edit message error:", err.message)
        return msg
    }
}


// deno-lint-ignore no-explicit-any
function logWithTime(... args: any[]) {
  console.log(new Date().toLocaleString(), ...args)
}
