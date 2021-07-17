import * as discord from "discord.js";
import { CommandArgs, CommandInterface } from ".";
import { log } from "../Util/util";

export default class Reset implements CommandInterface {
  name = "リセット";
  alias = ["reset"];
  description = "サーバーの設定やデータを削除して初期化します。";
  unlist = false;
  category = "utility";
  async run(message:discord.Message, options:CommandArgs){
    options.updateBoundChannel(message);
    // VC接続中なら切断
    if(options.data[message.guild.id].Manager.IsConnecting){
      options.data[message.guild.id].Manager.Disconnect();
    }
    // サーバープリファレンスをnullに
    options.data[message.guild.id] = null;
    // データ初期化
    options.initData(message.guild.id, message.channel.id);
    message.channel.send("✅サーバーの設定を初期化しました").catch(e => log(e, "error"));
  }
}