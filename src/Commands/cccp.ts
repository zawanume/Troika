/*
 * Copyright 2021-2022 mtripg6666tdr
 * 
 * This file is part of mtripg6666tdr/Discord-SimpleMusicBot. 
 * (npm package name: 'discord-music-bot' / repository url: <https://github.com/mtripg6666tdr/Discord-SimpleMusicBot> )
 * 
 * mtripg6666tdr/Discord-SimpleMusicBot is free software: you can redistribute it and/or modify it 
 * under the terms of the GNU General Public License as published by the Free Software Foundation, 
 * either version 3 of the License, or (at your option) any later version.
 *
 * mtripg6666tdr/Discord-SimpleMusicBot is distributed in the hope that it will be useful, 
 * but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. 
 * See the GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License along with mtripg6666tdr/Discord-SimpleMusicBot. 
 * If not, see <https://www.gnu.org/licenses/>.
 */

import type { CommandArgs } from ".";
import type { CommandMessage } from "../Component/CommandMessage";
import type * as ytsr from "ytsr";

import { BaseCommand } from ".";
import { searchYouTube } from "../AudioSource";
import { Util } from "../Util";

export default class Cccp extends BaseCommand {
  constructor(){
    super({
      name: "ソビエト",
      alias: ["cccp", "ussr"],
      description: "ソビエト社会主義連邦共和国の国歌を再生します。",
      unlist: false,
      category: "player",
      permissionDescription: "なし",
    });
  }

  async run(message:CommandMessage, options:CommandArgs){
    options.server.updateBoundChannel(message);
    const server = options.server;
    // キューが空だし引数もないし添付ファイルもない
    const wasConnected = server.player.isConnecting;
    // VCに入れない
    if(!(await options.server.joinVoiceChannel(message, /* reply */ false, /* reply when failed */ true))) return;
    // 一時停止されてるね
    if(options.rawArgs === "" && server.player.isPaused){
      server.player.resume();
      await message.reply(":arrow_forward: 再生を再開します。").catch(e => Util.logger.log(e, "error"));
      return;
    }

    server.player.stop();
    await server.playFromURL(message, "https://www.youtube.com/watch?v=rwAns-qsMPo",)
    //server.player.stop();
    //await server.queue.next();
    //await server.player.play();
  }
}
