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

import type { InteractionCollector } from "./collectors/InteractionCollector";
import type { ResponseMessage } from "./commandResolver/ResponseMessage";
import type { TaskCancellationManager } from "./taskCancellationManager";
import type { AudioSourceBasicJsonFormat } from "../AudioSource";
import type { GuildDataContainer } from "../Structure";
import type { AddedBy, QueueContent } from "../Structure/QueueContent";
import type { AnyTextableGuildChannel, EditMessageOptions, Message, MessageActionRow } from "oceanic.js";

import { lock, LockObj } from "@mtripg6666tdr/async-lock";
import { MessageActionRowBuilder, MessageButtonBuilder, MessageEmbedBuilder } from "@mtripg6666tdr/oceanic-command-resolver/helper";
import i18next from "i18next";
import { Member } from "oceanic.js";
import ytmpl from "yt-mix-playlist";
import ytdl from "ytdl-core";

import * as AudioSource from "../AudioSource";
import { ServerManagerBase } from "../Structure";
import * as Util from "../Util";
import { getColor } from "../Util/color";
import { bindThis } from "../Util/decorators";
import { useConfig } from "../config";
import { timeLoggedMethod } from "../logger";

export type KnownAudioSourceIdentifer = "youtube"|"custom"|"soundcloud"|"spotify"|"unknown";

interface QueueManagerEvents {
  change: [];
  changeWithoutCurrent: [];
  add: [content:QueueContent];
  settingsChanged: [];
  mixPlaylistEnabledChanged: [enabled: boolean];
}

const config = useConfig();

/**
 * サーバーごとのキューを管理するマネージャー。
 * キューの追加および削除などの機能を提供します。
 */
export class QueueManager extends ServerManagerBase<QueueManagerEvents> {
  /**
   * キューの本体
   */
  protected _default: QueueContent[] = [];
  /**
   * キューの本体のゲッタープロパティ
   */
  protected get default(): Readonly<QueueContent[]>{
    return this._default;
  }

  protected _loopEnabled: boolean = false;
  /**
   * トラックループが有効か?
   */
  get loopEnabled(): boolean{
    return this._loopEnabled;
  }

  set loopEnabled(value: boolean){
    this._loopEnabled = value;
    this.emit("settingsChanged");
  }

  protected _queueLoopEnabled: boolean = false;
  /**
   * キューループが有効か?
   */
  get queueLoopEnabled(): boolean{
    return this._queueLoopEnabled;
  }

  set queueLoopEnabled(value: boolean){
    this._queueLoopEnabled = value;
    this.emit("settingsChanged");
  }

  protected _onceLoopEnabled: boolean = false;
  /**
   * ワンスループが有効か?
   */
  get onceLoopEnabled(): boolean{
    return this._onceLoopEnabled;
  }

  set onceLoopEnabled(value: boolean){
    this._onceLoopEnabled = value;
    this.emit("settingsChanged");
  }

  /**
   * キューの長さ（トラック数）
   */
  get length(): number{
    return this.default.length;
  }

  /**
   * プライベートトラックを除いたキューの長さ（トラック数）
   */
  get publicLength(): number{
    return this.default.reduce((prev, current) => prev + (current.basicInfo.isPrivateSource ? 0 : 1), 0);
  }

  /**
   * キューの長さ（時間秒）
   * ライブストリームが含まれていた場合、NaNとなります
   */
  get lengthSeconds(): number{
    return this.default.reduce((prev, current) => prev + Number(current.basicInfo.lengthSeconds), 0);
  }

  /**
   * 現在取得できる限りのキューの長さ(時間秒)
   */
  get lengthSecondsActual(): number{
    return this.default.reduce((prev, current) => prev + Number(current.basicInfo.lengthSeconds || 0), 0);
  }

  get isEmpty(): boolean{
    return this.length === 0;
  }

  protected _mixPlaylist: Awaited<ReturnType<typeof ytmpl>>;
  get mixPlaylist(): Awaited<ReturnType<typeof ytmpl>> {
    return this._mixPlaylist;
  }
  set mixPlaylist(value: Awaited<ReturnType<typeof ytmpl>>){
    const oldState = this.mixPlaylistEnabled;
    this._mixPlaylist = value;
    const newState = this.mixPlaylistEnabled;
    if(newState !== oldState){
      this.emit("mixPlaylistEnabledChanged", newState);
    }
  }

  get mixPlaylistEnabled(){
    return !!this._mixPlaylist;
  }

  constructor(parent: GuildDataContainer){
    super("QueueManager", parent);
    this.logger.info("QueueManager instantiated");
  }

  /**
   * キュー内の指定されたインデックスの内容を返します
   * @param index インデックス
   * @returns 指定された位置にあるキューコンテンツ
   */
  get(index: number){
    return this.default[index];
  }

  /**
   * キュー内で与えられた条件に適合するものを配列として返却します
   * @param predicate 条件を表す関数
   * @returns 条件に適合した要素の配列
   */
  filter(predicate: (value: QueueContent, index: number, array: QueueContent[]) => unknown, thisArg?: any){
    return this.default.filter(predicate, thisArg);
  }

  /**
   * キュー内のコンテンツから与えられた条件に一致する最初の要素のインデックスを返却します
   * @param predicate 条件
   * @returns インデックス
   */
  findIndex(predicate: (value: QueueContent, index: number, obj: QueueContent[]) => unknown, thisArg?: any){
    return this.default.findIndex(predicate, thisArg);
  }

  /**
   * キュー内のコンテンツのすべてで与えられた関数を実行し結果を配列として返却します
   * @param callbackfn 変換する関数
   * @returns 変換後の配列
   */
  map<T>(callbackfn: (value: QueueContent, index: number, array: QueueContent[]) => T, thisArg?: any): T[]{
    return this.default.map(callbackfn, thisArg);
  }

  /**
   * キュー内のコンテンツのすべてで与えられた関数を実行します。
   * @param callbackfn 関数
   */
  forEach(callbackfn: (value: QueueContent, index: number, array: readonly QueueContent[]) => void, thisArg?: any){
    this.default.forEach(callbackfn, thisArg);
  }

  getLengthSecondsTo(index: number){
    let sec = 0;
    if(index < 0) throw new Error("Invalid argument: " + index);
    const target = Math.min(index, this.length);
    for(let i = 0; i <= target; i++){
      sec += this.get(i).basicInfo.lengthSeconds;
    }
    return sec;
  }

  private readonly addQueueLocker = new LockObj();

  @timeLoggedMethod
  async addQueueOnly<T extends AudioSourceBasicJsonFormat = AudioSourceBasicJsonFormat>({
    url,
    addedBy,
    method = "push",
    sourceType = "unknown",
    gotData = null,
    preventCache = false,
    preventSourceCache = false,
  }: {
    url: string,
    addedBy?: Member | AddedBy | null,
    method?: "push" | "unshift",
    sourceType?: KnownAudioSourceIdentifer,
    gotData?: T | null,
    preventCache?: boolean,
    preventSourceCache?: boolean,
  }): Promise<QueueContent & { index: number }>{
    return lock(this.addQueueLocker, async () => {
      this.logger.info("AddQueue called");
      const result = {
        basicInfo: await AudioSource.resolve(
          {
            url,
            type: sourceType,
            knownData: gotData,
            forceCache: !preventCache && (this.length === 0 || method === "unshift" || this.lengthSeconds < 4 * 60 * 60 * 1000),
          },
          this.server.bot.cache,
          preventSourceCache,
          i18next.getFixedT(this.server.locale)
        ),
        additionalInfo: {
          addedBy: {
            userId: addedBy && this.getUserIdFromMember(addedBy) || "0",
            displayName: addedBy?.displayName || i18next.t("unknown", { lng: this.server.locale }),
          },
        },
      } as QueueContent;
      if(result.basicInfo){
        this._default[method](result);
        if(this.server.equallyPlayback) this.sortWithAddedBy();
        this.emit(method === "push" ? "changeWithoutCurrent" : "change");
        this.emit("add", result);
        const index = this._default.findIndex(q => q === result);
        this.logger.info(`queue content added at position ${index}`);
        return { ...result, index };
      }
      throw new Error("Provided URL was not resolved as available service");
    });
  }

  /**
   * ユーザーへのインタラクションやキュー追加までを一括して行います
   * @returns 成功した場合はtrue、それ以外の場合はfalse
   */
  @timeLoggedMethod
  async addQueue(options: {
    url: string,
    addedBy: Member|AddedBy|null|undefined,
    sourceType?: KnownAudioSourceIdentifer,
    first?: boolean,
    gotData?: AudioSourceBasicJsonFormat,
    cancellable?: boolean,
    privateSource?: boolean,
  } & (
    {
      fromSearch: ResponseMessage,
      message?: undefined,
      channel?: undefined,
    } | {
      fromSearch?: undefined,
      message: ResponseMessage,
      channel?: undefined,
    } | {
      fromSearch?: undefined,
      message?: undefined,
      channel: AnyTextableGuildChannel,
    })
  ): Promise<QueueContent | null> {
    this.logger.info("AutoAddQueue Called");
    let uiMessage: Message<AnyTextableGuildChannel> | ResponseMessage | null = null;

    try{
      // UI表示するためのメッセージを特定する作業
      if(options.fromSearch){
        // 検索パネルからの場合
        this.logger.info("AutoAddQueue from search panel");
        uiMessage = options.fromSearch;
        await uiMessage.edit({
          content: "",
          embeds: [
            new MessageEmbedBuilder()
              .setTitle(i18next.t("pleaseWait", { lng: this.server.locale }))
              .setDescription(`${i18next.t("loadingInfo", { lng: this.server.locale })}...`)
              .toOceanic(),
          ],
          allowedMentions: {
            repliedUser: false,
          },
          components: [],
        });
      }else if(options.message){
        // すでに処理中メッセージがある場合
        this.logger.info("AutoAddQueue will report statuses to the specified message");
        uiMessage = options.message;
      }else if(options.channel){
        // まだないの場合（新しくUI用のメッセージを生成する）
        this.logger.info("AutoAddQueue will make a message that will be used to report statuses");
        uiMessage = await options.channel.createMessage({
          content: i18next.t("loadingInfoPleaseWait", { lng: this.server.locale }),
        });
      }

      // キューの長さ確認
      if(this.server.queue.length > 999){
        // キュー上限
        this.logger.warn("AutoAddQueue failed due to too long queue");
        // eslint-disable-next-line @typescript-eslint/no-throw-literal
        throw i18next.t("components:queue.tooManyQueueItems", { lng: this.server.locale });
      }

      // キューへの追加を実行
      const info = await this.server.queue.addQueueOnly({
        url: options.url,
        addedBy: options.addedBy,
        method: options.first ? "unshift" : "push",
        sourceType: options.sourceType || "unknown",
        gotData: options.gotData || null,
        preventSourceCache: options.privateSource,
      });

      // 非公開ソースで追加する場合には非公開ソースとしてマーク
      if(options.privateSource){
        info.basicInfo.markAsPrivateSource();
      }

      this.logger.info("AutoAddQueue worked successfully");

      // UIを表示する
      if(uiMessage){
        // 曲の時間取得＆計算
        const _t = Number(info.basicInfo.lengthSeconds);
        const [min, sec] = Util.time.calcMinSec(_t);
        // キュー内のオフセット取得
        const index = info.index.toString();
        // ETAの計算
        const timeFragments = Util.time.calcHourMinSec(
          this.getLengthSecondsTo(info.index) - _t - Math.floor(this.server.player.currentTime / 1000)
        );
        // 埋め込みの作成
        const embed = new MessageEmbedBuilder()
          .setColor(getColor("SONG_ADDED"))
          .setTitle(`✅${i18next.t("components:queue.songAdded", { lng: this.server.locale })}`)
          .setDescription(info.basicInfo.isPrivateSource ? info.basicInfo.title : `[${info.basicInfo.title}](${info.basicInfo.url})`)
          .addField(
            i18next.t("length", { lng: this.server.locale }),
            info.basicInfo.isYouTube() && info.basicInfo.isLiveStream
              ? i18next.t("liveStream", { lng: this.server.locale })
              : _t !== 0
                ? min + ":" + sec
                : i18next.t("unknown", { lng: this.server.locale }),
            true
          )
          .addField(
            i18next.t("components:nowplaying.requestedBy", { lng: this.server.locale }),
            options.addedBy?.displayName || i18next.t("unknown", { lng: this.server.locale }),
            true
          )
          .addField(
            i18next.t("components:queue.positionInQueue", { lng: this.server.locale }),
            index === "0"
              ? `${
                i18next.t("components:nowplaying.nowplayingItemName", { lng: this.server.locale })
              }/${
                i18next.t("components:nowplaying.waitForPlayingItemName", { lng: this.server.locale })
              }`
              : index,
            true
          )
          .addField(
            i18next.t("components:queue.etaToPlay", { lng: this.server.locale }),
            index === "0"
              ? "-"
              : timeFragments[2].includes("-")
                ? i18next.t("unknown", { lng: this.server.locale })
                : Util.time.HourMinSecToString(timeFragments, i18next.getFixedT(this.server.locale)),
            true
          )
        ;

        if(info.basicInfo.isYouTube()){
          if(info.basicInfo.isFallbacked){
            embed.addField(
              `:warning:${i18next.t("attention", { lng: this.server.locale })}`,
              i18next.t("components:queue.fallbackNotice", { lng: this.server.locale })
            );
          }else if(info.basicInfo.strategyId === 1){
            embed.setTitle(`${embed.title}*`);
          }
        }else if(info.basicInfo instanceof AudioSource.Spotify){
          embed.addField(
            `:warning:${i18next.t("attention", { lng: this.server.locale })}`,
            i18next.t("components:queue.spotifyNotice", { lng: this.server.locale })
          );
        }

        const components: MessageActionRow[] = [];

        // キャンセルボタンの作成
        const cancellable = !options.first && options.cancellable && !!options.addedBy;
        let collector: InteractionCollector | null = null;
        if(cancellable){
          const collectorCreateResult = this.server.bot.collectors
            .create()
            .setAuthorIdFilter(options.addedBy ? this.getUserIdFromMember(options.addedBy) : null)
            .setTimeout(5 * 60 * 1000)
            .createCustomIds({
              cancelLast: "button",
            });
          collector = collectorCreateResult.collector;

          components.push(
            new MessageActionRowBuilder()
              .addComponents(
                new MessageButtonBuilder()
                  .setCustomId(collectorCreateResult.customIdMap.cancelLast)
                  .setLabel(i18next.t("cancel", { lng: this.server.locale }))
                  .setStyle("DANGER")
              )
              .toOceanic()
          );

          collectorCreateResult.collector.once("cancelLast", interaction => {
            try{
              const item = this.get(this.length - 1);
              this.removeAt(this.length - 1);
              interaction.createFollowup({
                content: `🚮${i18next.t("components:queue.cancelAdded", { title: item.basicInfo.title, lng: this.server.locale })}`,
              }).catch(this.logger.error);
            }
            catch(er){
              this.logger.error(er);
              interaction.createFollowup({
                content: i18next.t("errorOccurred"),
              }).catch(this.logger.error);
            }
          });

          const destroyCollector = () => {
            this.off("change", destroyCollector);
            this.off("changeWithoutCurrent", destroyCollector);
            collector?.destroy();
          };
          this.once("change", destroyCollector);
          this.once("changeWithoutCurrent", destroyCollector);
        }

        let messageContent: EditMessageOptions | null = null;
        if(typeof info.basicInfo.thumbnail === "string"){
          embed.setThumbnail(info.basicInfo.thumbnail);
          messageContent = {
            content: "",
            embeds: [embed.toOceanic()],
            components,
          };
        }else{
          embed.setThumbnail("attachment://thumbnail." + info.basicInfo.thumbnail.ext);
          messageContent = {
            content: "",
            embeds: [embed.toOceanic()],
            components,
            files: [
              {
                name: "thumbnail." + info.basicInfo.thumbnail.ext,
                contents: info.basicInfo.thumbnail.data,
              },
            ],
          };
        }

        const lastReply = await uiMessage.edit(messageContent);
        collector?.setMessage(lastReply);
      }
      return info;
    }
    catch(e){
      this.logger.error("AutoAddQueue failed", e);
      if(uiMessage){
        uiMessage.edit({
          content: `:weary:${i18next.t("components:queue.failedToAdd", { lng: this.server.locale })}${typeof e === "object" && "message" in e ? `(${e.message})` : ""}`,
          embeds: [],
        })
          .catch(this.logger.error)
        ;
      }
      return null;
    }
  }

  /**
   * プレイリストを処理します
   * @param client botのクライアント
   * @param msg すでに返信済みの応答メッセージ
   * @param cancellation 処理のキャンセレーションマネージャー
   * @param queue キューマネージャー
   * @param first 最初に追加する場合はtrue、それ以外の場合はfalse
   * @param identifer オーディオソースサービス識別子
   * @param playlist プレイリスト本体。トラックの配列
   * @param title プレイリストのタイトル
   * @param totalCount プレイリストに含まれるトラック数
   * @param exportableConsumer トラックをexportableCustomに処理する関数
   * @returns 追加に成功した楽曲数
   */
  @timeLoggedMethod
  async processPlaylist<T>(
    msg: ResponseMessage,
    cancellation: TaskCancellationManager,
    first: boolean,
    identifer: KnownAudioSourceIdentifer,
    playlist: T[],
    title: string,
    totalCount: number,
    exportableConsumer: (track: T) => Promise<AudioSourceBasicJsonFormat>|AudioSourceBasicJsonFormat
  ): Promise<QueueContent[]>{
    let index = 0;
    const result: QueueContent[] = [];
    for(let i = 0; i < totalCount; i++){
      const item = playlist[i];
      if(!item) continue;
      const exportable = await exportableConsumer(item);
      const _result = await this.addQueueOnly({
        url: exportable.url,
        addedBy: msg.command.member,
        sourceType: identifer,
        method: first ? "unshift" : "push",
        gotData: exportable,
      }).catch(this.logger.error);
      if(_result){
        index++;
        result.push(_result);
      }
      if(
        index % 50 === 0
        || totalCount <= 50 && index % 10 === 0
        || totalCount <= 10 && index % 4 === 0
      ){
        await msg.edit(
          `:hourglass_flowing_sand:${
            i18next.t("components:queue.processingPlaylist", { title, lng: this.server.locale })
          }${i18next.t("pleaseWait", { lng: this.server.locale })}${
            i18next.t("default:songProcessingInProgress", {
              totalSongCount: i18next.t("default:totalSongCount", { count: totalCount, lng: this.server.locale }),
              currentSongCount: i18next.t("default:currentSongCount", { count: index, lng: this.server.locale }),
              lng: this.server.locale,
            })
          }`);
      }
      if(cancellation.cancelled){
        break;
      }
    }
    return result;
  }

  /**
   * 次の曲に移動します
   */
  async next(){
    this.logger.info("Next Called");

    this.onceLoopEnabled = false;
    this.server.player.resetError();

    if(this.queueLoopEnabled){
      this._default.push(this.default[0]);
    }else if(this.server.addRelated && this.server.player.currentAudioInfo instanceof AudioSource.YouTube){
      const relatedVideos = this.server.player.currentAudioInfo.relatedVideos;
      if(relatedVideos.length >= 1){
        const video = relatedVideos[0];
        if(typeof video === "string"){
          await this.addQueueOnly({
            url: video,
            addedBy: null,
            method: "push",
            sourceType: "youtube",
          });
        }else{
          await this.addQueueOnly({
            url: video.url,
            addedBy: null,
            method: "push",
            sourceType: "youtube",
            gotData: video,
          });
        }
      }
    }
    this._default.shift();
    this.emit("change");
  }

  async enableMixPlaylist(url: string, request: Member, skipAddingBase: boolean = false){
    this._mixPlaylist = await ytmpl(ytdl.getURLVideoID(url), {
      gl: config.country,
      hl: config.defaultLanguage,
    });
    if(!skipAddingBase){
      await this.addQueueOnly({
        url: url,
        addedBy: request,
        method: "push",
        sourceType: "youtube",
      });
    }else{
      await this.prepareNextMixItem();
    }
    await this.prepareNextMixItem();
    this.server.player.once("disconnect", this.disableMixPlaylist);
  }

  async prepareNextMixItem(): Promise<void> {
    if(!this.mixPlaylistEnabled) throw new Error("Mix playlist is currently disabled");

    // select and obtain the next song
    this._mixPlaylist = await this.mixPlaylist!.select(this.mixPlaylist!.currentIndex + 1);
    const item = this.mixPlaylist!.items[this.mixPlaylist!.currentIndex];

    // if a new song fetched, add it to the last in queue.
    if(item){
      if(!item.url){
        return this.prepareNextMixItem();
      }

      await this.addQueueOnly({
        url: item.url,
        addedBy: null,
        method: "push",
        sourceType: "youtube",
        gotData: {
          url: item.url,
          title: item.title,
          description: "No description due to being fetched via mix-list",
          length: item.duration.split(":").reduce((prev, current) => prev * 60 + Number(current), 0),
          channel: item.author?.name || "unknown",
          channelUrl: item.author?.url || "unknown",
          thumbnail: item.thumbnails[0].url,
          isLive: false,
        },
      });
    }else{
      this.disableMixPlaylist();
    }
  }

  @bindThis
  disableMixPlaylist(){
    this._mixPlaylist = null;
    this.server.player.off("disconnect", this.disableMixPlaylist);
  }

  /**
   * 指定された位置のキューコンテンツを削除します
   * @param offset 位置
   */
  removeAt(offset: number){
    if(this.server.player.isPlaying && offset === 0){
      throw new Error("The first item cannot be removed because it is being played right now.");
    }
    this.logger.info(`RemoveAt Called (offset:${offset})`);
    this._default.splice(offset, 1);
    this.emit(offset === 0 ? "change" : "changeWithoutCurrent");
  }

  /**
   * すべてのキューコンテンツを消去します
   */
  removeAll(){
    this.logger.info("RemoveAll Called");
    this._default = [];
    this.emit("change");
  }

  /**
   * 最初のキューコンテンツだけ残し、残りのキューコンテンツを消去します
   */
  removeFrom2nd(){
    this.logger.info("RemoveFrom2 Called");
    this._default = [this.default[0]];
    this.emit("changeWithoutCurrent");
  }

  /**
   * キューをシャッフルします
   */
  shuffle(){
    this.logger.info("Shuffle Called");
    if(this._default.length === 0) return;

    const addedByOrder: string[] = [];
    this._default.forEach(item => {
      if(!addedByOrder.includes(item.additionalInfo.addedBy.userId)){
        addedByOrder.push(item.additionalInfo.addedBy.userId);
      }
    });

    if(this.server.player.isPlaying || this.server.player.preparing){
      // 再生中/準備中には、キューの一番最初のアイテムの位置を変えずにそれ以外をシャッフルする
      const first = this._default.shift()!;
      this._default.sort(() => Math.random() - 0.5);
      this._default.unshift(first);
      this.emit("changeWithoutCurrent");
    }else{
      // キュー内のすべてのアイテムをシャッフルする
      this._default.sort(() => Math.random() - 0.5);
      this.emit("change");
    }
    if(this.server.equallyPlayback){
      this.sortWithAddedBy(addedByOrder);
    }
  }

  /**
   * 条件に一致するキューコンテンツをキューから削除します
   * @param validator 条件を表す関数
   * @returns 削除されたオフセットの一覧
   */
  removeIf(validator: (q: QueueContent) => boolean){
    this.logger.info("RemoveIf Called");
    if(this._default.length === 0) return [];
    const first = this.server.player.isPlaying ? 1 : 0;
    const rmIndex = [] as number[];
    for(let i = first; i < this._default.length; i++){
      if(validator(this._default[i])){
        rmIndex.push(i);
      }
    }
    rmIndex.sort((a, b) => b - a);
    rmIndex.forEach(n => this.removeAt(n));
    this.emit(rmIndex.includes(0) ? "change" : "changeWithoutCurrent");
    return rmIndex;
  }

  /**
   * キュー内で移動します
   * @param from 移動元のインデックス
   * @param to 移動先のインデックス
   */
  move(from: number, to: number){
    this.logger.info("Move Called");
    if(from < to){
      //要素追加
      this._default.splice(to + 1, 0, this.default[from]);
      //要素削除
      this._default.splice(from, 1);
    }else if(from > to){
      //要素追加
      this._default.splice(to, 0, this.default[from]);
      //要素削除
      this._default.splice(from + 1, 1);
    }
    this.emit(from === 0 || to === 0 ? "change" : "changeWithoutCurrent");
  }

  /**
   * 追加者によってできるだけ交互になるようにソートします
   */
  sortWithAddedBy(addedByUsers?: string[]){
    // 追加者の一覧とマップを作成
    const generateUserOrder = !addedByUsers;
    addedByUsers = addedByUsers || [];
    const queueByAdded = {} as { [key: string]: QueueContent[] };
    for(let i = 0; i < this._default.length; i++){
      if(!addedByUsers.includes(this._default[i].additionalInfo.addedBy.userId)){
        if(generateUserOrder){
          addedByUsers.push(this._default[i].additionalInfo.addedBy.userId);
        }
        queueByAdded[this._default[i].additionalInfo.addedBy.userId] = [this._default[i]];
      }else{
        queueByAdded[this._default[i].additionalInfo.addedBy.userId].push(this._default[i]);
      }
    }
    // ソートをもとにキューを再構築
    const sorted = [] as QueueContent[];
    const maxLengthByUser = Math.max(...addedByUsers.map(user => queueByAdded[user].length));
    for(let i = 0; i < maxLengthByUser; i++){
      sorted.push(...addedByUsers.map(user => queueByAdded[user][i]).filter(q => !!q));
    }
    this._default = sorted;
    this.emit("changeWithoutCurrent");
  }

  getRawQueueItems(){
    return [...this._default];
  }

  addRawQueueItems(items: QueueContent[]){
    this._default.push(...items);
  }

  protected getUserIdFromMember(member: Member | AddedBy){
    return member instanceof Member ? member.id : member.userId;
  }
}

