import * as discord from "discord.js";
import { CommandArgs, CommandInterface, SlashCommandArgument } from ".";
import { log } from "../Util/util";

export default class Rm implements CommandInterface {
  name = "削除";
  alias = ["消去", "rm", "remove"];
  description = "キュー内の指定された位置の曲を削除します。";
  unlist = false;
  category = "playlist";
  examples = "rm 5";
  usage = "削除 <削除する位置>"
  argument = [{
    type: "string",
    name: "削除するインデックス",
    description: "削除するインデックスはキューに併記されているものです。ハイフンを使って2-5のように範囲指定したり、スペースを使って1 4 8のように複数指定することも可能です。",
    required: true
  }] as SlashCommandArgument[]
  async run(message:discord.Message, options:CommandArgs){
    options.updateBoundChannel(message);
    if(options.args.length == 0){
      message.channel.send("引数に消去する曲のオフセット(番号)を入力してください。").catch(e => log(e, "error"));
      return;
    }
    if(options.args.indexOf("0") >= 0 && options.data[message.guild.id].Manager.IsPlaying) {
      message.channel.send("現在再生中の楽曲を削除することはできません。");
      return;
    }
    const q = options.data[message.guild.id].Queue;
    const addition = [] as number[];
    options.args.forEach(o => {
      let match = o.match(/^(?<from>[0-9]+)-(?<to>[0-9]+)$/);
      if(match){
        const from = Number(match.groups.from);
        const to = Number(match.groups.to);
        if(!isNaN(from) && !isNaN(to) && from<=to){
          for(let i = from; i <= to; i++){
            addition.push(i);
          }
        }
      }else{
        match = o.match(/^(?<from>[0-9]+)-$/);
        if(match){
          const from = Number(match.groups.from);
          if(!isNaN(from)){
            for(let i = from; i < q.length; i++){
              addition.push(i);
            }
          }
        }else{
          match = o.match(/^-(?<to>[0-9]+)$/);
          if(match){
            const to = Number(match.groups.to);
            if(!isNaN(to)){
              for(let i = (options.data[message.guild.id].Manager.IsPlaying ? 1 : 0); i <= to; i++){
                addition.push(i);
              }
            }
          }
        }
      }
    });
    let indexes = options.args.concat(addition.map(n => n.toString()));
    const dels = Array.from(new Set(
      indexes.map(str => Number(str)).filter(n => !isNaN(n)).sort((a,b)=>b-a)
    ));
    const title = dels.length === 1 ? q.get(dels[0]).BasicInfo.Title : null;
    for(let i = 0; i < dels.length; i++){
      q.RemoveAt(Number(dels[i]));
    }
    const resultStr = dels.sort((a,b)=>a-b).join(",");
    message.channel.send("🚮" + (resultStr.length > 100 ? "指定された" : resultStr + "番目の") + "曲" + (title ? ("(`" + title + "`)") : "") + "を削除しました").catch(e => log(e, "error"));
  }
}