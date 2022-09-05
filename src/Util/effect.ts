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

import type { GuildDataContainer } from "../Structure";

import { Helper } from "@mtripg6666tdr/eris-command-resolver";

import { getColor } from "./color";

export const EffectsCustomIds = {
  Reload: "reload",
  BassBoost: "bass_boost",
  Reverb: "reverb",
  LoudnessEqualization: "loudness_eq",
};

export function getFFmpegEffectArgs(data:GuildDataContainer){
  const effect = [];
  if(data.effectPrefs.BassBoost) effect.push("firequalizer=gain_entry='entry(75,2)'");
  if(data.effectPrefs.Reverb) effect.push("aecho=1.0:0.7:20:0.5");
  if(data.effectPrefs.LoudnessEqualization) effect.push("loudnorm");
  
  if(effect.length >= 1){
    return ["-af", effect.join(",")];
  }else{
    return [];
  }
}

export function getCurrentEffectPanel(avatarUrl:string, data:GuildDataContainer){
  const embed = new Helper.MessageEmbedBuilder()
    .setTitle(":cd:エフェクトコントロールパネル:microphone:")
    .setDescription("オーディオエフェクトの設定/解除することができます。\r\n・表示は古い情報であることがありますが、エフェクトを操作したとき、更新ボタンを押したときに更新されます。\r\n・エフェクトは次の曲から適用されます\r\n現在の曲に適用したい場合は、`頭出し`コマンドを使用してください\r\n")
    .addField("Bass Boost", data.effectPrefs.BassBoost ? "⭕" : "❌", true)
    .addField("Reverb", data.effectPrefs.Reverb ? "⭕" : "❌", true)
    .addField("Loudness Eq", data.effectPrefs.LoudnessEqualization ? "⭕" : "❌", true)
    .setColor(getColor("EFFECT"))
    .setFooter({
      icon_url: avatarUrl,
      text: "エフェクトを選択してボタンを押してください"
    })
  ;
  const messageActions = new Helper.MessageActionRowBuilder()
    .addComponents(
      new Helper.MessageButtonBuilder()
        .setCustomId("reload")
        .setStyle("PRIMARY")
        .setEmoji("🔁")
        .setLabel("更新"),
      new Helper.MessageButtonBuilder()
        .setCustomId("bass_boost")
        .setStyle(data.effectPrefs.BassBoost ? "SUCCESS" : "SECONDARY")
        .setLabel("Bass Boost"),
      new Helper.MessageButtonBuilder()
        .setCustomId("reverb")
        .setStyle(data.effectPrefs.Reverb ? "SUCCESS" : "SECONDARY")
        .setLabel("Reverb"),
      new Helper.MessageButtonBuilder()
        .setCustomId("loudness_eq")
        .setStyle(data.effectPrefs.LoudnessEqualization ? "SUCCESS" : "SECONDARY")
        .setLabel("Loudness Eq")
    )
    .toEris()
  ;
  
  return { embed, messageActions };
}
