import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, DeleteCommand, GetCommand, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import type { CollectionItem } from "./types";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: process.env.AWS_REGION || "us-east-1" }));

const USER_COLLECTIONS_TABLE = process.env.USER_COLLECTIONS_TABLE || "UserCollections";
const WORD_CACHE_TABLE = process.env.WORD_CACHE_TABLE || "WordCache";

export async function getWordCache(word: string): Promise<any | null> {
  const result = await ddb.send(new GetCommand({
    TableName: WORD_CACHE_TABLE,
    Key: { word: word.toLowerCase() }
  }));
  return result.Item?.data ?? null;
}

export async function putWordCache(word: string, data: any): Promise<void> {
  const ttlSec = Math.floor(Date.now() / 1000) + 7 * 24 * 3600;
  await ddb.send(new PutCommand({
    TableName: WORD_CACHE_TABLE,
    Item: {
      word: word.toLowerCase(),
      data,
      expireAt: ttlSec
    }
  }));
}

export async function listCollections(username: string): Promise<Record<string, any>> {
  const query = await ddb.send(new QueryCommand({
    TableName: USER_COLLECTIONS_TABLE,
    KeyConditionExpression: "username = :username",
    ExpressionAttributeValues: {
      ":username": username
    }
  }));
  const map: Record<string, any> = {};
  (query.Items as CollectionItem[] | undefined)?.forEach((item) => {
    map[item.word.toLowerCase()] = item.data;
  });
  return map;
}

export async function upsertCollections(username: string, words: CollectionItem[]): Promise<Record<string, any>> {
  await Promise.all(
    words.map((item) =>
      ddb.send(
        new PutCommand({
          TableName: USER_COLLECTIONS_TABLE,
          Item: {
            username,
            word: item.word.toLowerCase(),
            collectedAt: item.collectedAt,
            data: { ...item.data, collectedAt: item.collectedAt }
          }
        })
      )
    )
  );

  return listCollections(username);
}

export async function deleteCollection(username: string, word: string): Promise<void> {
  await ddb.send(
    new DeleteCommand({
      TableName: USER_COLLECTIONS_TABLE,
      Key: {
        username,
        word: word.toLowerCase()
      }
    })
  );
}
