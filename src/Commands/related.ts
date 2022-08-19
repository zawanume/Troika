import type { CommandArgs } from ".";
import type { CommandMessage } from "../Component/CommandMessage";

import * as discord from "discord.js";

import { BaseCommand } from ".";
import { Util } from "../Util";
import { getColor } from "../Util/color";

export default class Related extends BaseCommand {
  constructor(){
    super({
      name: "related",
      alias: ["関連動画", "関連曲", "おすすめ", "オススメ", "related", "relatedsong", "r", "recommend"],
      description: "YouTubeから楽曲を再生終了時に、関連曲をキューに自動で追加する機能の有効/無効を設定します",
      unlist: false,
      category: "playlist",
    });
  }

  async run(message:CommandMessage, options:CommandArgs){
    options.updateBoundChannel(message);
    if(options.data[message.guild.id].AddRelative){
      options.data[message.guild.id].AddRelative = false;
      message.reply("❌関連曲自動再生をオフにしました").catch(e => Util.logger.log(e, "error"));
    }else{
      options.data[message.guild.id].AddRelative = true;
      const embed = new discord.MessageEmbed()
        .setTitle("⭕関連曲自動再生をオンにしました")
        .setDescription("YouTubeからの楽曲再生終了時に、関連曲をキューの末尾に自動追加する機能です。\r\n※YouTube以外のソースからの再生時、ループ有効時には追加されません")
        .setColor(getColor("RELATIVE_SETUP"));
      message.reply({embeds: [embed]});
    }
  }
}
