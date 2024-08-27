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
import type { CommandMessage } from "../Component/commandResolver/CommandMessage";

import { BaseCommand } from ".";

export default class Cccp extends BaseCommand {
  constructor(){
    super({
      //name: "ソビエト",
      alias: ["cccp", "ussr","ソビエト","ソ連","ソビエト連邦","ソビエト社会主義共和国連邦"],
      //description: "ソビエト社会主義共和国連邦の国歌を再生します。",
      unlist: false,
      category: "player",
      //permissionDescription: "なし",
      shouldDefer: false,
      requiredPermissionsOr: [],
    });
  }

  async run(message:CommandMessage, options:CommandArgs){
    options.server.updateBoundChannel(message);
    const server = options.server;
    // VCに入れない
    if(!(await options.server.joinVoiceChannel(message, {replyOnFail:true}))) return;
    // 一時停止されてるね
    if(options.rawArgs === "" && server.player.isPaused){
      server.player.resume();
    }

    server.player.stop();
    await server.playFromUrl(message, "https://www.youtube.com/watch?v=rwAns-qsMPo", {});
    await server.queue.removeAt(1);
  }
}
