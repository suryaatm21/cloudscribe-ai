import express from "express";
import ffmpeg from "fluent-ffmpeg";

const app = express();
app.use(express.json());

app.post("/process-video", (req, res) => {
  console.log("Received body:", req.body); // Debugging
  const inputFilePath = req.body.inputFilePath;
  const outputFilePath = req.body.outputFilePath;

  if (!inputFilePath || !outputFilePath) {
    res.status(400).send("Bad Request: Missing file path");
  }

  ffmpeg(inputFilePath)
    .outputOptions("-vf", "scale=-1:360")
    .on("end", () => {
      // console.log('Processing finished successfully');
      res.status(200).send("Yuhhh");
    })
    .on("error", (err) => {
      console.log("internal error occured");
      res.status(500).send(`internal server error: ${err.message}`);
    })
    .save(outputFilePath);
});
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
