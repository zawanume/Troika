/*
 * Copyright 2021-2023 mtripg6666tdr
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

import type { MusicBot } from "../bot";
import type * as discord from "oceanic.js";

import i18next from "i18next";

import { QueueManagerWithBgm } from "../Component/QueueManagerWithBGM";
import { useConfig } from "../config";

const config = useConfig();

export async function onVoiceChannelLeave(
  this: MusicBot,
  member: discord.Member,
  oldChannel: discord.VoiceChannel | discord.StageChannel | discord.Uncached,
){
  if(!("guild" in oldChannel)) return;
  const server = this.guildData.get(oldChannel.guild.id);
  if(!server || !server.connection) return;

  if(member.id === this._client.user.id){
    // サーバー側からのボットの切断
    this.logger.info(`forced to disconnect from VC (${server.connectingVoiceChannel?.id})`);
    await server.player.disconnect().catch(this.logger.error);
    await this._client.rest.channels.createMessage(
      server.boundTextChannel,
      {
        content: `:postbox: ${i18next.t("disconnected", { lng: server.locale })}`,
      }
    ).catch(this.logger.error);
  }else if(oldChannel.voiceMembers.has(this._client.user.id) && oldChannel.voiceMembers.size === 1){
    if(server.queue instanceof QueueManagerWithBgm && server.queue.isBGM){
      await server.player.disconnect().catch(this.logger.error);
    }else if(server.player.isPlaying && !config.twentyFourSeven.includes(oldChannel.id) && !config.alwaysTwentyFourSeven){
      // 誰も聞いてる人がいない
      await server.player.disconnect().catch(this.logger.error);
      /*if(
        server.player.currentAudioInfo.lengthSeconds > 60
        && server.player.currentAudioInfo.lengthSeconds - server.player.currentTime / 1000 < 10
      ){
        // かつ、楽曲の長さが60秒以上
        // かつ、残り時間が10秒以内
        // ならば、切断。
        this.logger.info(`audio left less than 10sec; automatically disconnected from VC (${server.connectingVoiceChannel?.id})`);
        await server.player.disconnect().catch(this.logger.error);
        if(!server.queue.onceLoopEnabled && !server.queue.loopEnabled){
          server.queue.next().catch(this.logger.error);
        }
        await this._client.rest.channels.createMessage(
          server.boundTextChannel,
          {
            content: `:postbox: ${i18next.t("disconnected", { lng: server.locale })}`,
          }
        ).catch(this.logger.error);
      }else if(!server.player.isPaused){
        // すでに一時停止されていないならば、一時停止する
        server.player.pause(member);
        await this._client.rest.channels.createMessage(
          server.boundTextChannel,
          {
            content: `:pause_button:${i18next.t("autoPaused", { lng: server.locale })}`,
          }
        ).catch(this.logger.error);
        const timer = setTimeout(() => {
          server.player.off("playCalled", playHandler);
          server.player.off("disconnect", playHandler);
          if(server.player.isPaused){
            this._client.rest.channels.createMessage(
              server.boundTextChannel,
              {
                content: `:postbox: ${i18next.t("autoDisconnect", { lng: server.locale })}`,
              }
            ).catch(this.logger.error);
            server.player.disconnect().catch(this.logger.error);
          }
        }, 10 * 60 * 1000).unref();
        const playHandler = () => clearTimeout(timer);
        server.player.once("playCalled", playHandler);
        server.player.once("disconnect", playHandler);
      }*/
    }else if(server.player.finishTimeout){
      await server.player.disconnect().catch(this.logger.error);
      await this._client.rest.channels.createMessage(
        server.boundTextChannel,
        {
          content: `:postbox: ${i18next.t("disconnected", { lng: server.locale })}`,
        }
      ).catch(this.logger.error);
    }
  }

  server.skipSession?.checkThreshold().catch(this.logger.error);
}
