import { Client } from "discord.js";
import * as fs from "fs";
import * as path from "path";
import { MusicBot } from "../bot";
import { CommandMessage } from "../Component/CommandMessage"
import { PageToggle } from "../Component/PageToggle";
import { GuildDataContainer } from "../definition";
import { TaskCancellationManager } from "../Component/TaskCancellationManager";
import Commands from "./commands";
import { log } from "../Util";

export interface CommandInterface {
  run(message:CommandMessage, options:CommandArgs):Promise<void>;
  name: string;
  alias: string[];
  description?: string;
  unlist: boolean;
  examples?: string;
  usage?: string;
  category?:string;
  argument?:SlashCommandArgument[]
}

export interface SlashCommandArgument {
  type:"bool"|"integer"|"string",
  name:string,
  description:string,
  required:boolean
}

export interface CommandArgs {
  bot:MusicBot;
  data:{[key:string]:GuildDataContainer};
  rawArgs: string;
  args: string[];
  updateBoundChannel(message:CommandMessage):void;
  EmbedPageToggle:PageToggle[];
  client:Client;
  Join(message:CommandMessage, reply?:boolean):Promise<boolean>;
  PlayFromURL(message:CommandMessage, optiont:string, first:boolean):Promise<void>;
  initData(guildid:string, channelid:string):void;
  cancellations:TaskCancellationManager[];
}

export class CommandsManager {
  private static _instance = null as CommandsManager;
  static get Instance(){
    if(this._instance) return this._instance;
    else return this._instance = new CommandsManager();
  }
  get Commands(){
    return this.commands;
  }

  private commands = null as CommandInterface[];

  private constructor(){
    log("[CommandsManager]Initializing");
    this.commands = [];
      fs.readdirSync(__dirname, {withFileTypes: true})
      .filter(d => d.isFile())
      .map(d => d.name)
      .filter(n => n.endsWith(".js") && n !== "index.js")
      .map(n => n.slice(0, -3))
      .forEach(n => {
        const cp = new (require(path.join(__dirname, n)).default)() as CommandInterface;
        this.commands.push(cp);
        if(cp.name === "コマンド"){
          (cp as Commands).commands = this.commands;
        }
        return cp;
      });
    log("[CommandsManager]Initialized");
  }

  resolve(command:string){
    log("[CommandsManager]Resolve() called");
    let result = null;
    for(let i = 0; i < this.commands.length; i++){
      if(this.commands[i].name === command || this.commands[i].alias.indexOf(command) >= 0){
        result = this.commands[i];
        break;
      }
    }
    if(result)
      log("[CommandsManager]Command `" + command + "` was resolved successfully");
    else
      log("[CommandsManager]Command not found");
    return result;
  }

  Check(){
    return true;
  }
}