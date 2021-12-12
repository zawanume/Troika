import type { exportableCustom } from "./AudioSource";
import type { YmxFormat } from "./definition";
import type { CommandArgs } from "./Commands";
import { execSync } from "child_process";
import * as discord from "discord.js";
import * as voice from "@discordjs/voice";
import * as ytpl from "ytpl";
import { CommandsManager } from "./Commands";
import { PageToggle } from "./Component/PageToggle";
import { TaskCancellationManager } from "./Component/TaskCancellationManager";
import { GuildDataContainer, NotSendableMessage, YmxVersion } from "./definition";
import { getColor } from "./Util/colorUtil";
import { DatabaseAPI } from "./Util/databaseUtil";
import {
  CheckSendable,
  GetMemInfo, isAvailableRawAudioURL,
  log,
  logStore,
  NormalizeText,
  timer
} from "./Util";
import { CommandMessage } from "./Component/CommandMessage"
import { ResponseMessage } from "./Component/ResponseMessage";
import Soundcloud from "soundcloud.ts";
import { addOn } from "./Util/addonUtil";

/**
 * 音楽ボットの本体
 */
export class MusicBot {
  // クライアントの初期化
  private client = new discord.Client({intents: [
    // サーバーを認識する
    discord.Intents.FLAGS.GUILDS,
    // サーバーのメッセージを認識する
    discord.Intents.FLAGS.GUILD_MESSAGES,
    // サーバーのボイスチャンネルのステータスを確認する
    discord.Intents.FLAGS.GUILD_VOICE_STATES,
  ]});
  private data:{[key:string]:GuildDataContainer} = {};
  private instantiatedTime = null as Date;
  private versionInfo = "Could not get info";
  private cancellations = [] as TaskCancellationManager[];
  private EmbedPageToggle:PageToggle[] = [] as PageToggle[];
  private isReadyFinished = false;
  private queueModifiedGuilds = [] as string[];
  private addOn = new addOn();
  /**
   * ページトグル
   */
  get Toggles(){return this.EmbedPageToggle};
  /**
   * クライアント
   */
  get Client(){return this.client};
  /**
   * キューが変更されたサーバーの保存
   */
  get QueueModifiedGuilds(){return this.queueModifiedGuilds};
  /**
   * バージョン情報  
   * (リポジトリの最終コミットのハッシュ値)
   */
  get Version(){return this.versionInfo};
  /**
   * 初期化された時刻
   */
  get InstantiatedTime(){return this.instantiatedTime}; 

  constructor(private maintenance:boolean = false){
    this.instantiatedTime = new Date();
    const client = this.client;
    log("[Main]Main bot is instantiated");
    if(maintenance){
      log("[Main]Main bot is now maintainance mode");
    }
    try{
      this.versionInfo = execSync("git log -n 1 --pretty=format:%h").toString().trim();
    }
    catch{};

    client
      .on("ready", this.onReady.bind(this))
      .on("messageCreate", this.onMessageCreate.bind(this))
      .on("interactionCreate", this.interactionCreate.bind(this))
      ;
  }

  private async onReady(client:discord.Client<true>){
    this.addOn.emit("ready", client);
    log("[Main]Socket connection is ready.");
    log("[Main]Starting environment checking and preparation.");

    // Set activity as booting
    if(!this.maintenance){
      client.user.setActivity({
        type: "PLAYING",
        name: "起動中..."
      });
    }else{
      client.user.setActivity({
        type: "PLAYING",
        name: "メンテナンス中..."
      });
      client.user.setStatus("dnd");
    }

    // Recover queues
    if(DatabaseAPI.CanOperate){
      const queues = await DatabaseAPI.GetQueueData([...client.guilds.cache.keys()]);
      const speakingIds = await DatabaseAPI.GetIsSpeaking([...client.guilds.cache.keys()]);
      const queueGuildids = Object.keys(queues);
      const speakingGuildids = Object.keys(speakingIds);
      for(let i=0;i<queueGuildids.length;i++){
        let id = queueGuildids[i];
        const queue = JSON.parse(queues[id]) as YmxFormat;
        if(
          speakingGuildids.indexOf(id) >= 0 && 
          queue.version === YmxVersion && 
          speakingIds[id].indexOf(":") >= 0
          ){
          //VCのID:バインドチャンネルのID:ループ:キューループ:関連曲
          const [vid, cid, ..._bs] = speakingIds[id].split(":");
          const [loop, qloop, related] = _bs.map(b => b === "1");
          this.initData(id, cid);
          this.data[id].boundTextChannel = cid;
          this.data[id].Queue.LoopEnabled = loop;
          this.data[id].Queue.QueueLoopEnabled = qloop;
          this.data[id].AddRelative = related;
          try{
            for(let j=0;j<queue.data.length;j++){
              await this.data[id].Queue.AutoAddQueue(client, queue.data[j].url, null, "unknown", false, false, null, null, queue.data[j]);
            }
            if(vid != "0"){
              const vc = await client.channels.fetch(vid) as discord.VoiceChannel;
              voice.joinVoiceChannel({
                channelId: vc.id,
                guildId: vc.guild.id,
                adapterCreator: vc.guild.voiceAdapterCreator
              });
              await this.data[id].Player.Play();
            }
          }
          catch(e){
            log(e, "warn");
          }
        }
      }
      log("[Main]Finish queues and states recovery.");
    }else{
      log("[Main]Cannot perform queues and states recovery. Check .env file to perform.", "warn");
    }

    // Set activity
    if(!this.maintenance){
      client.user.setActivity({
        type: "LISTENING",
        name: "音楽"
      });

      // Set main tick
      const tick = ()=>{
        this.Log();
        setTimeout(tick, 4 * 60 * 1000);
        PageToggle.Organize(this.EmbedPageToggle, 5);
        this.BackupData();
      };
      setTimeout(tick, 1 * 60 * 1000);
    }
    log("[Main]Main tick was set successfully");

    // Command instance preparing
    CommandsManager.Instance.Check();
    log("[Main]Finish preparing commands");

    // Finish initializing
    this.isReadyFinished = true;
    log("[Main]Bot is ready");
  }

  private async onMessageCreate(message:discord.Message){
    this.addOn.emit("messageCreate", message);
    if(this.maintenance){
      if(!process.env.ADMIN_USER || message.author.id !== process.env.ADMIN_USER)
        return;
    }
    // botのメッセやdm、およびnewsは無視
    if(!this.isReadyFinished || message.author.bot || message.channel.type !== "GUILD_TEXT") return;
    // データ初期化
    this.initData(message.guild.id, message.channel.id);
    // プレフィックスの更新
    this.updatePrefix(message);
    if(message.content === "<@" + this.client.user.id + ">") {
      // メンションならば
      message.channel
        .send("コマンドは、`" + this.data[message.guild.id].PersistentPref.Prefix + "command`で確認できます")
        .catch(e => log(e, "error"));
      return;
    }
    if(message.content.startsWith(this.data[message.guild.id].PersistentPref.Prefix)){
      // コマンドメッセージを作成
      const commandMessage = CommandMessage.createFromMessage(message, this.data);
      // コマンドを解決
      const command = CommandsManager.Instance.resolve(commandMessage.command);
      if(!command) return;
      // 送信可能か確認
      if(!(await CheckSendable(message.channel as discord.TextChannel, message.guild.members.resolve(this.client.user)))){
        try{
          await message.reply({
            content: NotSendableMessage,
            allowedMentions: {
              repliedUser: false
            }
          });
        }
        catch{}
        return;
      }
      // コマンドの処理
      await command.run(commandMessage, this.createCommandRunnerArgs(commandMessage.options, commandMessage.rawOptions));
    }else if(this.data[message.guild.id] && this.data[message.guild.id].SearchPanel){
      // searchコマンドのキャンセルを捕捉
      if(message.content === "キャンセル" || message.content === "cancel") {
        const msgId = this.data[message.guild.id].SearchPanel.Msg;
        if(msgId.userId !== message.author.id) return;
        this.data[message.guild.id].SearchPanel = null;
        await message.channel.send("✅キャンセルしました");
        try{
          const ch = await this.client.channels.fetch(msgId.chId);
          const msg = await (ch as discord.TextChannel).messages.fetch(msgId.id);
          await msg.delete();
        }
        catch(e){
          log(e, "error");
        }
      }
      // searchコマンドの選択を捕捉
      else if(NormalizeText(message.content).match(/^([0-9]\s?)+$/)){
        const panel = this.data[message.guild.id].SearchPanel;
        if(!panel) return;
        // メッセージ送信者が検索者と一致するかを確認
        if(message.author.id !== panel.Msg.userId) return;
        const nums = NormalizeText(message.content).split(" ");
        const responseMessage = await(await this.client.channels.fetch(panel.Msg.chId) as discord.TextChannel).messages.fetch(panel.Msg.id);
        await this.playFromSearchPanelOptions(nums, message.guild.id, ResponseMessage.createFromMessage(responseMessage, null));
      }
    }else if(
      this.cancellations.filter(c => !c.Cancelled).length > 0 && 
      (message.content === "キャンセル" || message.content === "cancel")
      ){
      this.cancellations.forEach(c => c.Cancel());
      message.channel.send("処理中の処理をすべてキャンセルしています....").catch(e => log(e, "error"));
    }
  }

  private async interactionCreate(interaction:discord.Interaction){
    this.addOn.emit("interactionCreate", interaction);
    if(this.maintenance){
      if(!process.env.ADMIN_USER || interaction.user.id !== process.env.ADMIN_USER)
      return;
    }
    if(interaction.user.bot) return;
    // データ初期化
    this.initData(interaction.guild.id, interaction.channel.id);
    // コマンドインタラクション
    if(interaction.isCommand()){
      log("[Main]Command Interaction received");
      if(!interaction.channel.isText()){
        await interaction.reply("テキストチャンネルで実行してください");
        return;
      }
      // 送信可能か確認
      if(!(await CheckSendable(interaction.channel as discord.TextChannel, interaction.guild.members.resolve(this.client.user)))){
        await interaction.reply(NotSendableMessage);
        return;
      }
      // コマンドを解決
      const command = CommandsManager.Instance.resolve(interaction.commandName);
      if(command){
        // 遅延リプライ
        await interaction.deferReply();
        // メッセージライクに解決してコマンドメッセージに
        const commandMessage = CommandMessage.createFromInteraction(this.client, interaction);
        // コマンドを実行
        await command.run(commandMessage, this.createCommandRunnerArgs(commandMessage.options, commandMessage.rawOptions));
      }else{
        await interaction.reply("おっと！なにかが間違ってしまったようです。\r\nコマンドが見つかりませんでした。 :sob:");
      }
    // ボタンインタラクション
    }else if(interaction.isButton()){
      log("[Main]Button Interaction received");
      await interaction.deferUpdate();
      const l = this.EmbedPageToggle.filter(t => 
        t.Message.channelId === interaction.channel.id && 
        t.Message.id === interaction.message.id);
      if(
        l.length >= 1 &&
        interaction.customId === PageToggle.arrowLeft || interaction.customId === PageToggle.arrowRight
        ){
          // ページめくり
          await l[0].FlipPage(
            interaction.customId === PageToggle.arrowLeft ? (l[0].Current >= 1 ? l[0].Current - 1 : 0) :
            interaction.customId === PageToggle.arrowRight ? (l[0].Current < l[0].Length - 1 ? l[0].Current + 1 : l[0].Current ) : 0
            ,
            interaction
            );
        }else{
          await interaction.editReply("失敗しました!");
        }
    }else if(interaction.isSelectMenu()){
      log("[Main]SelectMenu Interaction received");
      // 検索パネル取得
      const panel = this.data[interaction.guild.id].SearchPanel;
      // なければ返却
      if(!panel) return;
      // インタラクションしたユーザーを確認
      if(interaction.user.id !== panel.Msg.userId) return;
      await interaction.deferUpdate();
      if(interaction.customId === "search"){
        if(interaction.values.indexOf("cancel") >= 0){
          this.data[interaction.guild.id].SearchPanel = null;
          await interaction.channel.send("✅キャンセルしました");
          await interaction.deleteReply();
        }else{
          const message = interaction.message;
          let responseMessage = null as ResponseMessage;
          if(message instanceof discord.Message){
            responseMessage = ResponseMessage.createFromInteractionWithMessage(interaction, message, null);
          }else{
            responseMessage = ResponseMessage.createFromInteraction(this.client, interaction, message, null);
          }
          await this.playFromSearchPanelOptions(interaction.values, interaction.guild.id, responseMessage)
        }
      }
    }
  }

  /**
   *  定期ログを実行します
   */
  Log(){
    const _d = Object.values(this.data);
    const memory = GetMemInfo();
    log("[Main]Participating Server(s) count: " + this.client.guilds.cache.size);
    log("[Main]Registered Server(s) count: " + Object.keys(this.data).length);
    log("[Main]Connecting Server(s) count: " + _d.filter(info => info.Player.IsPlaying).length);
    log("[Main]Paused Server(s) count: " + _d.filter(_d => _d.Player.IsPaused).length);
    log("[System]Free:" + Math.floor(memory.free) + "MB; Total:" + Math.floor(memory.total) + "MB; Usage:" + memory.usage + "%");
  }

  /**
   * Botを開始します。
   * @param token Botのトークン
   * @param debugLog デバッグログを出力するかどうか
   * @param debugLogStoreLength デバッグログの保存する数
   */
  Run(token:string, debugLog:boolean = false, debugLogStoreLength?:number){
    this.client.login(token).catch(e => log(e, "error"));
    logStore.log = debugLog;
    if(debugLogStoreLength) logStore.maxLength = debugLogStoreLength;
  }

  /**
   * キューをエクスポートしてテキストにします
   */
  exportQueue(guildId:string):string{
    return JSON.stringify({
      version: YmxVersion,
      data: this.data[guildId].Queue.map(q => q.BasicInfo.exportData())
    } as YmxFormat);
  }

  /**
   * 接続ステータスやキューを含む全データをサーバーにバックアップします
   */
  BackupData(){
    if(DatabaseAPI.CanOperate){
      const t = timer.start("MusicBot#BackupData");
      try{
        this.BackupStatus();
        // キューの送信
        const queue = [] as {guildid:string, queue:string}[];
        const guilds = this.queueModifiedGuilds;
        this.queueModifiedGuilds = [];
        guilds.forEach(id => {
          queue.push({
            guildid: id,
            queue: this.exportQueue(id)
          });
        });
        if(queue.length > 0){
          DatabaseAPI.SetQueueData(queue);
        }
      }
      catch(e){
        log(e, "warn");
      };
      t.end();
    }
  }

  /**
   * 接続ステータス等をサーバーにバックアップします
   */
  BackupStatus(){
    const t = timer.start("MusicBot#BackupStatus");
    try{
      // 参加ステータスの送信
      const speaking = [] as {guildid:string, value:string}[];
      Object.keys(this.data).forEach(id => {
        speaking.push({
          guildid: id,
          // VCのID:バインドチャンネルのID:ループ:キューループ:関連曲
          value: (this.data[id].Player.IsPlaying && !this.data[id].Player.IsPaused ? 
            voice.getVoiceConnection(id).joinConfig.channelId : "0") 
            + ":" + this.data[id].boundTextChannel 
            + ":" + (this.data[id].Queue.LoopEnabled ? "1" : "0") 
            + ":" + (this.data[id].Queue.QueueLoopEnabled ? "1" : "0") 
            + ":" + (this.data[id].AddRelative ? "1" : "0")
        });
      });
      DatabaseAPI.SetIsSpeaking(speaking);
    }
    catch(e){
      log(e, "warn");
    }
    t.end();
  }

  /**
   * 必要に応じてサーバーデータを初期化します
   */
  private initData(guildid:string, channelid:string){
    if(!this.data[guildid]) {
      this.data[guildid] = new GuildDataContainer(this.Client, guildid, channelid, this);
      this.data[guildid].Player.SetData(this.data[guildid]);
      this.data[guildid].Queue.SetData(this.data[guildid]);
    }
  }

  /**
   * コマンドを実行する際にランナーに渡す引数を生成します
   * @param options コマンドのパース済み引数
   * @param optiont コマンドの生の引数
   * @returns コマンドを実行する際にランナーに渡す引数
   */
  private createCommandRunnerArgs(options:string[], optiont:string):CommandArgs{
    return {
      EmbedPageToggle: this.EmbedPageToggle,
      args: options,
      bot: this,
      data: this.data,
      rawArgs: optiont,
      updateBoundChannel: this.updateBoundChannel.bind(this),
      client: this.client,
      Join: this.Join.bind(this),
      PlayFromURL: this.PlayFromURL.bind(this),
      initData: this.initData.bind(this),
      cancellations: this.cancellations
    };
  }

  /**
   * ボイスチャンネルに接続します
   * @param message コマンドを表すメッセージ
   * @param reply 応答が必要な際に、コマンドに対して返信で応じるか新しいメッセージとして応答するか。(デフォルトではfalse)
   * @returns 成功した場合はtrue、それ以外の場合にはfalse
   */
  private async Join(message:CommandMessage, reply:boolean = false):Promise<boolean>{
    const t = timer.start("MusicBot#Join");
    if(message.member.voice.channel){
      // すでにVC入ってるよ～
      if(message.member.voice.channel.members.has(this.client.user.id)){
        const connection = voice.getVoiceConnection(message.guild.id);
        if(connection){
          t.end();
          return true;
        }
      }

      // 入ってないね～参加しよう
      const msg = reply ? await message.reply(":electric_plug:接続中...") : await message.channel.send(":electric_plug:接続中...");
      try{
        voice.joinVoiceChannel({
          channelId: message.member.voice.channel.id,
          guildId: message.member.guild.id,
          adapterCreator: message.member.guild.voiceAdapterCreator,
          debug: Boolean(process.env.DEBUG)
        }).on("debug", (mes) => log("[Connection]" + mes));
        log("[Main/" + message.guild.id + "]VC Connected to " + message.member.voice.channel.id);
        await msg.edit(":+1:ボイスチャンネル:speaker:`" + message.member.voice.channel.name + "`に接続しました!");
        t.end();
        return true;
      }
      catch(e){
        log(e, "error");
        msg?.delete();
        message.reply("😑接続に失敗しました…もう一度お試しください。").catch(e => log(e, "error"));
        this.data[message.guild.id].Player.Disconnect();
        t.end();
        return false;
      }
    }else{
      // あらメッセージの送信者さんはボイチャ入ってないん…
      reply ? 
      await message.reply("ボイスチャンネルに参加してからコマンドを送信してください:relieved:").catch(e => log(e, "error")) :
      await message.channel.send("ボイスチャンネルに参加してからコマンドを送信してください:relieved:").catch(e => log(e, "error"));
      t.end();
      return false;
    }
  };

  /**
   * メッセージからストリームを判定してキューに追加し、状況に応じて再生を開始します
   * @param first キューの先頭に追加するかどうか
   */
  private async PlayFromURL(message:CommandMessage, optiont:string, first:boolean = true){
    const t = timer.start("MusicBot#PlayFromURL");
    setTimeout(()=> message.suppressEmbeds(true).catch(e => log(e, "warn")), 4000);
    if(optiont.match(/^https?:\/\/(www\.|canary\.|ptb\.)?discord(app)?\.com\/channels\/[0-9]+\/[0-9]+\/[0-9]+$/)){
      // Discordメッセへのリンクならば
      const smsg = await message.reply("🔍メッセージを取得しています...");
      try{
        const ids = optiont.split("/");
        const ch = await this.client.channels.fetch(ids[ids.length - 2]);
        if(ch.type === "GUILD_TEXT"){
          const msg = await (ch as discord.TextChannel).messages.fetch(ids[ids.length - 1]);
          if(msg.attachments.size > 0 && isAvailableRawAudioURL(msg.attachments.first().url)){
            await this.data[message.guild.id].Queue.AutoAddQueue(this.client, msg.attachments.first().url, message.member, "custom", first, false, message.channel as discord.TextChannel, smsg);
            this.data[message.guild.id].Player.Play();
            return;
          }else throw "添付ファイルが見つかりません";
        }else throw "メッセージの取得に失敗"
      }
      catch(e){
        await smsg.edit("✘追加できませんでした(" + e + ")").catch(e => log(e ,"error"));
      }
    }else if(isAvailableRawAudioURL(optiont)){
      // オーディオファイルへの直リンク？
      await this.data[message.guild.id].Queue.AutoAddQueue(this.client, optiont, message.member, "custom", first, false, message.channel as discord.TextChannel);
      this.data[message.guild.id].Player.Play();
      return;
    }else if(optiont.indexOf("v=") < 0 && ytpl.validateID(optiont)){
      //違うならYouTubeプレイリストの直リンクか？
      const id = await ytpl.getPlaylistID(optiont);
      const msg = await message.reply(":hourglass_flowing_sand:プレイリストを処理しています。お待ちください。");
      const result = await ytpl.default(id, {
        gl: "JP",
        hl: "ja",
        limit: 999
      });
      const cancellation = new TaskCancellationManager();
      this.cancellations.push(cancellation);
      const index = await this.data[message.guild.id].Queue.ProcessPlaylist(this.client, msg, cancellation, first, "youtube", result.items, result.title, result.estimatedItemCount, (c) => ({
        url: c.url,
        channel: c.author.name,
        description: "プレイリストから指定のため詳細は表示されません",
        isLive: c.isLive,
        length: c.durationSec,
        thumbnail: c.thumbnails[0].url,
        title: c.title
      } as exportableCustom));
      if(cancellation.Cancelled){
        await msg.edit("✅キャンセルされました。");
      }else{
        const embed = new discord.MessageEmbed()
          .setTitle("✅プレイリストが処理されました")
          .setDescription("[" + result.title + "](" + result.url + ") `(" + result.author.name + ")` \r\n" + index + "曲が追加されました")
          .setThumbnail(result.bestThumbnail.url)
          .setColor(getColor("PLAYLIST_COMPLETED"));
        await msg.edit({content: null, embeds: [embed]});
      }
      this.cancellations.splice(this.cancellations.findIndex(c => c === cancellation), 1);
      this.data[message.guild.id].Player.Play();
    }else if(optiont.match(/https?:\/\/soundcloud.com\/.+\/sets\/.+/)){
      const msg = await message.reply(":hourglass_flowing_sand:プレイリストを処理しています。お待ちください。");
      const sc = new Soundcloud();
      const playlist = await sc.playlists.getV2(optiont);
      const cancellation = new TaskCancellationManager();
      this.cancellations.push(cancellation);
      const index = await this.data[message.guild.id].Queue.ProcessPlaylist(this.client, msg, cancellation, first, "soundcloud", playlist.tracks, playlist.title, playlist.track_count, async (track) => {
        const item = await sc.tracks.getV2(track.id);
        return{
          url: item.permalink_url,
          title: item.title,
          description: item.description,
          length: Math.floor(item.duration / 1000),
          author: item.user.username,
          thumbnail: item.artwork_url
        } as exportableCustom
      });
      if(cancellation.Cancelled){
        await msg.edit("✅キャンセルされました。");
      }else{
        const embed = new discord.MessageEmbed()
          .setTitle("✅プレイリストが処理されました")
          .setDescription("[" + playlist.title + "](" + playlist.permalink_url + ") `(" + playlist.user.username + ")` \r\n" + index + "曲が追加されました")
          .setThumbnail(playlist.artwork_url)
          .setColor(getColor("PLAYLIST_COMPLETED"));
        await msg.edit({content: null, embeds: [embed]});
      }
      this.cancellations.splice(this.cancellations.findIndex(c => c === cancellation), 1);
      this.data[message.guild.id].Player.Play();
    }else{
      try{
        await this.data[message.guild.id].Queue.AutoAddQueue(this.client, optiont, message.member, "unknown", first, false, message.channel as discord.TextChannel, await message.reply("お待ちください..."));
        this.data[message.guild.id].Player.Play();
        return;
      }
      catch{
        // なに指定したし…
        message.reply("🔭有効なURLを指定してください。キーワードで再生する場合はsearchコマンドを使用してください。").catch(e => log(e, "error"));
        return;
      }
    }
    t.end();
  }

  /**
   * 状況に応じてバインドチャンネルを更新します
   * @param message 更新元となるメッセージ
   */
  private async updateBoundChannel(message:CommandMessage){
    // テキストチャンネルバインド
    // コマンドが送信されたチャンネルを後で利用します。
    if(
      !this.data[message.guild.id].Player.IsConnecting || 
      (message.member.voice.channel && message.member.voice.channel.members.has(this.client.user.id)) || 
      message.content.indexOf("join") >= 0
      ){
      if(message.content !== (this.data[message.guild.id] ? this.data[message.guild.id].PersistentPref.Prefix : ">"))
      this.data[message.guild.id].boundTextChannel = message.channelId;
    }
  }

  /**
   * プレフィックス更新します
   * @param message 更新元となるメッセージ
   */
  private updatePrefix(message:discord.Message):void{
    const pmatch = message.guild.members.resolve(this.client.user.id).displayName.match(/^\[(?<prefix>.)\]/);
    if(pmatch){
      if(this.data[message.guild.id].PersistentPref.Prefix !== pmatch.groups.prefix){
        this.data[message.guild.id].PersistentPref.Prefix = pmatch.groups.prefix;
      }
    }else if(this.data[message.guild.id].PersistentPref.Prefix !== ">"){
      this.data[message.guild.id].PersistentPref.Prefix = ">";
    }
  }

  /**
   * 検索パネルのオプション番号を表すインデックス番号から再生します
   * @param nums インデックス番号の配列
   * @param guildid サーバーID
   * @param member 検索者のメンバー
   * @param message 検索パネルが添付されたメッセージ自体を指す応答メッセージ
   */
  private async playFromSearchPanelOptions(nums:string[], guildid:string, message:ResponseMessage){
    const t = timer.start("MusicBot#playFromSearchPanelOptions");
    const panel = this.data[guildid].SearchPanel;
    const member = await (await this.client.guilds.fetch(guildid)).members.fetch(panel.Msg.userId);
    const num = nums.shift();
    if(Object.keys(panel.Opts).indexOf(num) >= 0){
      await this.data[guildid].Queue.AutoAddQueue(this.client, panel.Opts[Number(num)].url, member, "unknown", false, message);
      this.data[guildid].SearchPanel = null;
      if(
        this.data[guildid].Player.IsConnecting && 
        !this.data[guildid].Player.IsPlaying
        ){
        this.data[guildid].Player.Play();
      }
    }
    nums.filter(n => Object.keys(panel.Opts).indexOf(n) >= 0).map(n => Number(n)).forEach(async n => {
      await this.data[guildid].Queue.AutoAddQueue(this.client, panel.Opts[n].url, member, "unknown", false, false, message.channel as discord.TextChannel);
    });
    t.end();
  }
}
