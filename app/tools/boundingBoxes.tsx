import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { tool } from "@langchain/core/tools";
import { QueryResult, QueryData, QueryError } from '@supabase/supabase-js';
import { Database } from "../types/supabase"; // Import the Database type

// Define the schema for the input
const BoundingBoxInput = z.object({
  state: z.string().describe("The state to filter bounding boxes by"),
});

// Create the Supabase client
const supabase = createClient<Database>(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_PRIVATE_KEY!,
);

// Define the tool
const boundingBoxesTool = tool(
  async (input: z.infer<typeof BoundingBoxInput>, config) => {
    const { state } = input;
    const maxRetries = 3;
    let attempt = 0;
    let boundingBoxes: Database["public"]["Tables"]["Bounding Boxes"]["Row"][] | null = null; // Use the imported type
    let error = null;

    while (attempt < maxRetries) {
      attempt++;
      try {
        // Log the state name for debugging
        console.log(`Attempt ${attempt}: Querying bounding boxes for state: ${state}`);

        // Query the Supabase table with a hardcoded limit of 1
        const boundingBoxesQuery = supabase
          .from("Bounding Boxes")
          .select("*")
          .ilike("STATE_NAME", state)
          .limit(1); // Hardcoded limit

        type BoundingBoxesData = QueryData<typeof boundingBoxesQuery>;

        const { data, error } = await boundingBoxesQuery;
        if (error) throw error;
        boundingBoxes = data as BoundingBoxesData;

        // Log the result for debugging
        console.log(`Attempt ${attempt}: Query result:`, boundingBoxes);

        if (!boundingBoxes || boundingBoxes.length === 0) {
          console.warn(`Attempt ${attempt}: No bounding boxes found for state: ${state}`);
          throw new Error(`No bounding boxes found for state: ${state}`);
        }

        // If successful, break out of the loop
        break;
      } catch (err) {
        if (attempt >= maxRetries) {
          const error = err as Error; // Type assertion
          console.error(`Failed after ${maxRetries} attempts: ${error.message}`);
          throw error;
        }
      }
    }

    // Ensure boundingBoxes is not null
    if (!boundingBoxes) {
      throw new Error("Bounding boxes data is null");
    }

    // Divide each bounding box into 4 equal parts
    const dividedBoundingBoxes = boundingBoxes.flatMap(box => {
      if (box.y_min === null || box.y_max === null || box.x_min === null || box.x_max === null) {
        return [];
      }

      const { y_min, y_max, x_min, x_max, COUNTY_NAME } = box;
      const y_mid = (y_min + y_max) / 2;
      const x_mid = (x_min + x_max) / 2;

      return [
        { COUNTY_NAME, y_min, y_max: y_mid, x_min, x_max: x_mid },
        { COUNTY_NAME, y_min, y_max: y_mid, x_min: x_mid, x_max },
        { COUNTY_NAME, y_min: y_mid, y_max, x_min, x_max: x_mid },
        { COUNTY_NAME, y_min: y_mid, y_max, x_min: x_mid, x_max },
      ];
    });

    // Initialize the map variable
    const map = new google.maps.Map(document.createElement('div'));

    // Perform a text search for "restaurant" within each divided bounding box
    const searchResults = await Promise.all(dividedBoundingBoxes.map(async (box) => {
      const { y_min, y_max, x_min, x_max } = box;
      const bounds = new google.maps.LatLngBounds(
        new google.maps.LatLng(y_min, x_min),  // Southwest corner
        new google.maps.LatLng(y_max, x_max)   // Northeast corner
      );

      return new Promise((resolve, reject) => {
        const request = {
          bounds: bounds,
          type: 'restaurant'
        };

        const service = new google.maps.places.PlacesService(map);
        service.nearbySearch(request, (results, status) => {
          if (status === google.maps.places.PlacesServiceStatus.OK && results) {
            const placeIds = results.map(place => place.place_id);
            resolve(placeIds);
          } else {
            console.error(`Error searching for places: ${status}`);
            resolve([]);
          }
        });
      });
    }));

    return searchResults.flat();
  },
  {
    name: "BoundingBoxesTool",
    description: "Inputs a state, outputs place IDs of restaurants within divided bounding boxes.",
    schema: BoundingBoxInput,
  },
);

export { boundingBoxesTool };