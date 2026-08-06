const { Pinecone } = require('@pinecone-database/pinecone');

let pineconeClient = null;
let pineconeIndex = null;

const getPineconeClient = () => {
  if (!pineconeClient) {
    pineconeClient = new Pinecone({
      apiKey: process.env.PINECONE_API_KEY,
    });
  }
  return pineconeClient;
};

const getPineconeIndex = () => {
  if (!pineconeIndex) {
    const client = getPineconeClient();
    pineconeIndex = client.index(process.env.PINECONE_INDEX_NAME);
  }
  return pineconeIndex;
};

module.exports = { getPineconeClient, getPineconeIndex };
