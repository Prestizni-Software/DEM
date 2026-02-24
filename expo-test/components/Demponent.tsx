import { Test } from "@/backend/ClientTypes";
import { DEM } from "@/backend/gay";
import { random } from "lodash";
import { useState, useEffect } from "react";
import { FlatList, Text, TouchableOpacity, View } from "react-native";
// Note: Usually you want the standard FlatList unless specifically animating

const Demponent = () => {
    const [data, setData] = useState<Test[]>([]);

    // 1. Setup the callback for when an item is pressed
    const handleItemPress = (item: Test) => {
        console.log("Item pressed:", item);
        item.setValue("description", random().toString());
    };

    // 2. FIXED: Logic to handle data updates and subscription
    useEffect(() => {
        // Initial load
        setData(DEM.Test.objectsAsArray as any);

        // Define the update function
        const onUpdate = (obj: any, key: any) => {
            // Re-fetch data or update state here
            // using spread [...] to ensure React detects the array change
            setData([...DEM.Test.objectsAsArray] as any); 
        };

        // Assign the callback
        DEM.Test.callbacks.update = onUpdate;

        // Cleanup: remove callback when component unmounts
        return () => {
        };
    }, []);

    return (
        <FlatList
            data={data}
            // Good practice: add a keyExtractor
            keyExtractor={(item, index) => index.toString()} 
            renderItem={({ item }) => (
                <TouchableOpacity 
                    onPress={() => handleItemPress(item)}
                    style={{ padding: 10, borderBottomWidth: 1, borderColor: '#ccc' }} // Added basic styling for hit-box
                >
                    <Text>{JSON.stringify(item.extractedData)}</Text>
                </TouchableOpacity>
            )}
        />
    );
};

export default Demponent;