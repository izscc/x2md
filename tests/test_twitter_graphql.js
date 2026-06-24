const assert = require("assert");

const { extractGraphQLOperationIdsFromScriptText } = require("../extension/twitter_graphql.js");

function testOperationIdsAreExtractedFromParamsShape() {
    const ids = extractGraphQLOperationIdsFromScriptText(`
        params:{id:"jd3V43oDY9cY7obs1YMfbQ",name:"TweetDetail",operationKind:"query"}
        params:{id:"-4_LMahNlI4MuLJ-EAFEog",name:"TweetResultByRestId",operationKind:"query"}
    `);

    assert.deepStrictEqual(ids.TweetDetail, ["jd3V43oDY9cY7obs1YMfbQ"]);
    assert.deepStrictEqual(ids.TweetResultByRestId, ["-4_LMahNlI4MuLJ-EAFEog"]);
}

testOperationIdsAreExtractedFromParamsShape();
console.log("twitter_graphql tests passed");
